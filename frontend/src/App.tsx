import React, { useState, useRef, useEffect } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { Navbar } from './components/Navbar';
import { VideoInput } from './components/VideoInput';
import { VideoPlayer } from './components/VideoPlayer';
import { SegmentNav } from './components/SegmentNav';
import { SocraticQuiz } from './components/SocraticQuiz';
import { NotesModal } from './components/NotesModal';
import { AiTutorPanel } from './components/AiTutorPanel';
import { ProgressView } from './components/ProgressView';
import type { VideoSession, QAHistoryItem } from './types';
import { processVideo, segmentVisual, visualAvailability, frameUrl } from './lib/api';
import {
  loadPersistedSession,
  savePersistedSession,
  clearPersistedSession,
  type PersistedSession,
} from './lib/persistence';
import { saveSessionToHistory } from './lib/sessionHistory';

export const App: React.FC = () => {
  // Restore the last study session (video + chapter + mastery) on reload so a
  // refresh resumes instead of resetting progress.
  const [restored] = useState<PersistedSession | null>(() => loadPersistedSession());
  const restoredSegCount = restored?.session?.segments.length ?? 0;
  const clampIdx = (i: number) =>
    Math.max(0, Math.min(i, Math.max(restoredSegCount - 1, 0)));

  const [session, setSession] = useState<VideoSession | null>(
    restored?.session ?? null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  
  // Progression state
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(
    clampIdx(restored?.activeSegmentIndex ?? 0)
  );
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(
    Math.max(0, restored?.activeQuestionIndex ?? 0)
  );
  const [completedSegmentIds, setCompletedSegmentIds] = useState<Set<number>>(
    () => new Set(restored?.completedSegmentIds ?? [])
  );
  const [needsReviewSegmentIds, setNeedsReviewSegmentIds] = useState<Set<number>>(
    () => new Set(restored?.needsReviewSegmentIds ?? [])
  );
  // High-water mark of chapters reached this session — nav locking uses this so
  // revisiting earlier chapters never re-locks forward ones.
  const [maxReachedIndex, setMaxReachedIndex] = useState(
    clampIdx(restored?.maxReachedIndex ?? 0)
  );
  const [isPausedForQuiz, setIsPausedForQuiz] = useState(false);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [qaHistory, setQaHistory] = useState<QAHistoryItem[]>(
    restored?.qaHistory ?? []
  );
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [isProgressOpen, setIsProgressOpen] = useState(false);
  // Latch so one boundary crossing can't fire twice (interval tick race), and so
  // revisits via nav/rewatch/proceed re-arm boundary handling for that segment.
  const boundaryLatchRef = useRef<number | null>(null);

  // Lazily enrich each chapter with a Gemini-vision keyframe (thumbnail + visual
  // insight) once a session loads. Fully opt-in: skipped when the backend reports
  // the media toolchain is unavailable, and cancellable so a reset/new video stops it.
  const sessionVideoId = session?.video_id;
  useEffect(() => {
    if (!sessionVideoId || !session) return;
    const segs = session.segments;
    if (!segs || segs.length === 0) return;
    let alive = true;

    (async () => {
      try {
        const avail = await visualAvailability();
        if (!alive || !avail.enabled) return;
      } catch {
        return;
      }
      for (const seg of segs) {
        if (!alive) return;
        if (seg.visual) continue;
        try {
          const res = await segmentVisual({
            video_id: sessionVideoId,
            start_time: seg.start_time,
            end_time: seg.end_time,
            title: seg.title,
            summary: seg.summary,
          });
          if (!alive) return;
          setSession((prev) => {
            if (!prev || prev.video_id !== sessionVideoId) return prev;
            return {
              ...prev,
              segments: prev.segments.map((s) =>
                s.segment_id === seg.segment_id
                  ? {
                      ...s,
                      visual: res.visual,
                      keyframe_url: frameUrl(sessionVideoId, res.timestamp),
                      keyframe_time: res.timestamp,
                    }
                  : s
              ),
            };
          });
        } catch {
          // Per-segment failures are non-fatal; leave that chapter text-only.
          if (!alive) return;
        }
      }
    })();

    return () => {
      alive = false;
    };
    // Keyed only on the session video id: enrichment merges additively and must
    // not re-trigger itself as segments gain visual fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionVideoId]);

  // Persist progress on every change so a refresh resumes the same session.
  useEffect(() => {
    if (!session) return;
    savePersistedSession({
      session,
      activeSegmentIndex,
      activeQuestionIndex,
      completedSegmentIds: Array.from(completedSegmentIds),
      needsReviewSegmentIds: Array.from(needsReviewSegmentIds),
      maxReachedIndex,
      qaHistory,
    });
  }, [
    session,
    activeSegmentIndex,
    activeQuestionIndex,
    completedSegmentIds,
    needsReviewSegmentIds,
    maxReachedIndex,
    qaHistory,
  ]);

  // Synchronize cross-video learning history into localStorage
  useEffect(() => {
    if (!session) return;
    const completedCount = completedSegmentIds.size;
    const totalTopics = session.segments.length;
    const isAllDone = totalTopics > 0 && completedCount >= totalTopics;

    saveSessionToHistory({
      sessionId: session.video_id,
      videoId: session.video_id,
      lectureTitle: session.title,
      totalTopics,
      completedTopics: completedCount,
      currentTopicIndex: activeSegmentIndex,
      status: isAllDone ? 'complete' : 'active',
      needsReviewCount: needsReviewSegmentIds.size,
      understoodConcepts: qaHistory.flatMap((q) => q.understood_concepts || []),
      missingConcepts: qaHistory.flatMap((q) => q.missing_concepts || []),
      misconceptions: qaHistory.flatMap((q) => q.misconceptions || []),
    });
  }, [
    session,
    completedSegmentIds,
    needsReviewSegmentIds,
    activeSegmentIndex,
    qaHistory,
  ]);

  const handleProcessVideo = async (url: string) => {
    setIsLoading(true);
    setLoadingStep('Fetching video transcript & structure...');
    try {
      const data = await processVideo(url);
      setSession(data);
      setActiveSegmentIndex(0);
      setActiveQuestionIndex(0);
      setCompletedSegmentIds(new Set());
      setNeedsReviewSegmentIds(new Set());
      setMaxReachedIndex(0);
      setIsPausedForQuiz(false);
      setQaHistory([]);
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const handleReset = () => {
    boundaryLatchRef.current = null;
    clearPersistedSession();
    setSession(null);
    setActiveSegmentIndex(0);
    setActiveQuestionIndex(0);
    setCompletedSegmentIds(new Set());
    setNeedsReviewSegmentIds(new Set());
    setMaxReachedIndex(0);
    setIsPausedForQuiz(false);
    setQaHistory([]);
    setIsNotesModalOpen(false);
    setIsProgressOpen(false);
  };

  const handleBoundaryReached = () => {
    if (!session || !activeSegment) return;
    if (boundaryLatchRef.current === activeSegment.segment_id) return;
    boundaryLatchRef.current = activeSegment.segment_id;

    // Already quizzed on this segment: flow into the next one seamlessly instead
    // of re-locking playback (contiguous boundaries, so no seek needed).
    if (completedSegmentIds.has(activeSegment.segment_id)) {
      if (activeSegmentIndex < session.segments.length - 1) {
        setMaxReachedIndex((p) => Math.max(p, activeSegmentIndex + 1));
        setActiveSegmentIndex(activeSegmentIndex + 1);
        setActiveQuestionIndex(0);
      }
      return;
    }
    setIsPausedForQuiz(true);
  };

  const handleTriggerQuiz = () => {
    setIsPausedForQuiz(true);
  };

  const handleRewatchSegment = () => {
    boundaryLatchRef.current = null;
    setIsPausedForQuiz(false);
    if (activeSegment) {
      setSeekTime(activeSegment.start_time);
    }
  };

  const activeSegment = session?.segments[activeSegmentIndex];

  const handleQuestionCompleted = (
    userAnswer: string,
    aiFeedback: string,
    attempts: number,
    needsReview?: boolean,
    score?: number,
    understood?: string[],
    missing?: string[],
    misconceptions?: string[]
  ) => {
    if (!activeSegment) return;
    const currentQ = activeSegment.questions[activeQuestionIndex];
    if (!currentQ) return;

    if (needsReview) {
      setNeedsReviewSegmentIds((prev) => {
        const next = new Set(prev);
        next.add(activeSegment.segment_id);
        return next;
      });
    }

    setQaHistory((prev) => [
      ...prev,
      {
        segment_title: activeSegment.title,
        question: currentQ.prompt,
        user_final_answer: userAnswer,
        ai_feedback: aiFeedback,
        attempts,
        needs_review: Boolean(needsReview),
        score: score ?? (needsReview ? 40 : 85),
        understood_concepts: understood || [],
        missing_concepts: missing || [],
        misconceptions: misconceptions || [],
      },
    ]);
  };

  const handleProceedToNextTopic = () => {
    if (!session || !activeSegment) return;
    boundaryLatchRef.current = null;

    // Check if more questions remain in current segment
    if (activeQuestionIndex < activeSegment.questions.length - 1) {
      setActiveQuestionIndex((prev) => prev + 1);
      return;
    }

    // Mark current segment completed
    const updatedCompleted = new Set(completedSegmentIds);
    updatedCompleted.add(activeSegment.segment_id);
    setCompletedSegmentIds(updatedCompleted);

    // Check if next segment exists
    if (activeSegmentIndex < session.segments.length - 1) {
      const nextIndex = activeSegmentIndex + 1;
      const nextSeg = session.segments[nextIndex];
      setMaxReachedIndex((p) => Math.max(p, nextIndex));
      setActiveSegmentIndex(nextIndex);
      setActiveQuestionIndex(0);
      setIsPausedForQuiz(false);
      setSeekTime(nextSeg.start_time);
    } else {
      // All segments finished!
      setIsNotesModalOpen(true);
    }
  };

  const handleSelectSegment = (index: number) => {
    if (!session) return;
    boundaryLatchRef.current = null;
    const seg = session.segments[index];
    setActiveSegmentIndex(index);
    setActiveQuestionIndex(0);
    setIsPausedForQuiz(false);
    setSeekTime(seg.start_time);
  };

  const isLastSegment = session
    ? activeSegmentIndex === session.segments.length - 1
    : false;
  const isLastQuestion = activeSegment
    ? activeQuestionIndex === activeSegment.questions.length - 1
    : true;

  return (
    <ThemeProvider>
    <div className="min-h-screen bg-surface text-ink flex flex-col selection:bg-ember-500/30 selection:text-ember-100">
      <Navbar
        hasActiveSession={!!session}
        onReset={handleReset}
        onOpenNotes={() => setIsNotesModalOpen(true)}
        canViewNotes={qaHistory.length > 0}
        onOpenProgress={() => setIsProgressOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col">
        {!session ? (
          <VideoInput
            onProcess={handleProcessVideo}
            isLoading={isLoading}
            loadingStep={loadingStep}
          />
        ) : (
          <div className="flex-1 flex flex-col gap-6">
            {/* Top Video Information Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-line-soft">
              <div className="min-w-0 flex-1">
                <h1 className="font-display text-xl sm:text-2xl font-bold text-ink tracking-tight truncate">
                  {session.title}
                </h1>
                {session.author && (
                  <p className="text-xs text-ink-faint">By {session.author}</p>
                )}
              </div>

              <div className="flex items-center gap-2.5 flex-shrink-0">
                <button
                  onClick={() => setIsProgressOpen(true)}
                  className="px-3.5 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/25 hover:bg-amber-500/20 transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <span>Analytics</span>
                  {needsReviewSegmentIds.size > 0 && (
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                  )}
                </button>
                <button
                  onClick={handleTriggerQuiz}
                  className="px-3.5 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold bg-warning/10 text-warning border border-warning/25 hover:bg-warning/20 transition-all cursor-pointer flex items-center justify-center"
                >
                  Trigger Quiz Check Now
                </button>
                <button
                  onClick={() => setIsNotesModalOpen(true)}
                  className="px-3.5 py-2 min-h-[44px] rounded-xl text-xs sm:text-sm font-semibold bg-ember-500/10 text-ember-300 border border-ember-500/25 hover:bg-ember-500/20 transition-all cursor-pointer flex items-center justify-center"
                >
                  Notes Preview ({qaHistory.length})
                </button>
              </div>
            </div>

            {/* Main Interactive Studio Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Video Player + quiz overlay (8 cols) */}
              <div className="lg:col-span-8 flex flex-col gap-6">
                {activeSegment && (
                  <VideoPlayer
                    videoId={session.video_id}
                    activeSegment={activeSegment}
                    segments={session.segments}
                    isPausedForQuiz={isPausedForQuiz}
                    onBoundaryReached={handleBoundaryReached}
                    seekTime={seekTime}
                    onRewatchSegment={handleRewatchSegment}
                    quizOverlay={
                      <SocraticQuiz
                        videoId={session.video_id}
                        activeSegment={activeSegment}
                        activeQuestionIndex={activeQuestionIndex}
                        isPausedForQuiz={isPausedForQuiz}
                        isLastSegment={isLastSegment}
                        isLastQuestion={isLastQuestion}
                        onQuestionCompleted={handleQuestionCompleted}
                        onProceedToNextTopic={handleProceedToNextTopic}
                        onOpenNotes={() => setIsNotesModalOpen(true)}
                      />
                    }
                  />
                )}
              </div>

              {/* Right Column: AI Tutor Guidance & Segment Chapters (4 cols; stacks below video on mobile) */}
              <div className="lg:col-span-4 flex flex-col gap-6">
                <AiTutorPanel
                  segments={session.segments}
                  activeSegmentIndex={activeSegmentIndex}
                  completedSegmentIds={completedSegmentIds}
                  needsReviewSegmentIds={needsReviewSegmentIds}
                  isPausedForQuiz={isPausedForQuiz}
                  activeQuestionIndex={activeQuestionIndex}
                  totalQuestionsInSegment={activeSegment?.questions.length || 1}
                  onSelectSegment={handleSelectSegment}
                />

                <SegmentNav
                  segments={session.segments}
                  activeSegmentIndex={activeSegmentIndex}
                  completedSegmentIds={completedSegmentIds}
                  needsReviewSegmentIds={needsReviewSegmentIds}
                  unlockedUpTo={maxReachedIndex}
                  onSelectSegment={handleSelectSegment}
                />
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Synthesized Notes & PDF Export Modal */}
      {session && (
        <NotesModal
          isOpen={isNotesModalOpen}
          onClose={() => setIsNotesModalOpen(false)}
          videoTitle={session.title}
          videoId={session.video_id}
          segments={session.segments}
          qaHistory={qaHistory}
        />
      )}

      {/* Learning Progress & Analytics Modal */}
      {session && (
        <ProgressView
          isOpen={isProgressOpen}
          onClose={() => setIsProgressOpen(false)}
          videoTitle={session.title}
          videoId={session.video_id}
          segments={session.segments}
          completedSegmentIds={completedSegmentIds}
          needsReviewSegmentIds={needsReviewSegmentIds}
          qaHistory={qaHistory}
          onOpenNotes={() => setIsNotesModalOpen(true)}
        />
      )}
    </div>
    </ThemeProvider>
  );
};

export default App;
