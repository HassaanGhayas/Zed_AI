import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { VideoInput } from './components/VideoInput';
import { VideoPlayer } from './components/VideoPlayer';
import { SegmentNav } from './components/SegmentNav';
import { SocraticQuiz } from './components/SocraticQuiz';
import { NotesModal } from './components/NotesModal';
import type { VideoSession, QAHistoryItem } from './types';
import { processVideo } from './lib/api';

export const App: React.FC = () => {
  const [session, setSession] = useState<VideoSession | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  
  // Progression state
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [completedSegmentIds, setCompletedSegmentIds] = useState<Set<number>>(new Set());
  const [isPausedForQuiz, setIsPausedForQuiz] = useState(false);
  const [seekTime, setSeekTime] = useState<number | null>(null);
  const [qaHistory, setQaHistory] = useState<QAHistoryItem[]>([]);
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);

  const handleProcessVideo = async (url: string) => {
    setIsLoading(true);
    setLoadingStep('Fetching video transcript & structure...');
    try {
      const data = await processVideo(url);
      setSession(data);
      setActiveSegmentIndex(0);
      setActiveQuestionIndex(0);
      setCompletedSegmentIds(new Set());
      setIsPausedForQuiz(false);
      setQaHistory([]);
    } finally {
      setIsLoading(false);
      setLoadingStep('');
    }
  };

  const handleReset = () => {
    setSession(null);
    setActiveSegmentIndex(0);
    setActiveQuestionIndex(0);
    setCompletedSegmentIds(new Set());
    setIsPausedForQuiz(false);
    setQaHistory([]);
    setIsNotesModalOpen(false);
  };

  const handleBoundaryReached = () => {
    setIsPausedForQuiz(true);
  };

  const handleRewatchSegment = () => {
    setIsPausedForQuiz(false);
    if (activeSegment) {
      setSeekTime(activeSegment.start_time);
    }
  };

  const activeSegment = session?.segments[activeSegmentIndex];

  const handleQuestionCompleted = (
    userAnswer: string,
    aiFeedback: string,
    attempts: number
  ) => {
    if (!activeSegment) return;
    const currentQ = activeSegment.questions[activeQuestionIndex];
    if (!currentQ) return;

    setQaHistory((prev) => [
      ...prev,
      {
        segment_title: activeSegment.title,
        question: currentQ.prompt,
        user_final_answer: userAnswer,
        ai_feedback: aiFeedback,
        attempts,
      },
    ]);
  };

  const handleProceedToNextTopic = () => {
    if (!session || !activeSegment) return;

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
    <div className="min-h-screen bg-surface text-ink flex flex-col selection:bg-ember-500/30 selection:text-ember-100">
      <Navbar
        hasActiveSession={!!session}
        onReset={handleReset}
        onOpenNotes={() => setIsNotesModalOpen(true)}
        canViewNotes={qaHistory.length > 0}
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
              <div>
                <h2 className="font-display text-xl sm:text-2xl font-bold text-ink tracking-tight">
                  {session.title}
                </h2>
                {session.author && (
                  <p className="text-xs text-ink-faint">By {session.author}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsPausedForQuiz(true)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-warning/10 text-warning border border-warning/25 hover:bg-warning/20 transition-all cursor-pointer"
                >
                  Trigger Quiz Check Now
                </button>
                <button
                  onClick={() => setIsNotesModalOpen(true)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-ember-500/10 text-ember-300 border border-ember-500/25 hover:bg-ember-500/20 transition-all cursor-pointer"
                >
                  Notes Preview ({qaHistory.length})
                </button>
              </div>
            </div>

            {/* Main Interactive Studio Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Video Player (7 cols) */}
              <div className="lg:col-span-7 flex flex-col gap-6">
                {activeSegment && (
                  <VideoPlayer
                    videoId={session.video_id}
                    activeSegment={activeSegment}
                    isPausedForQuiz={isPausedForQuiz}
                    onBoundaryReached={handleBoundaryReached}
                    seekTime={seekTime}
                    onRewatchSegment={handleRewatchSegment}
                  />
                )}

                {/* Segment Chapters Navigation */}
                <div className="hidden lg:block">
                  <SegmentNav
                    segments={session.segments}
                    activeSegmentIndex={activeSegmentIndex}
                    completedSegmentIds={completedSegmentIds}
                    onSelectSegment={handleSelectSegment}
                  />
                </div>
              </div>

              {/* Right Column: Socratic Active Recall Quiz (5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                {activeSegment && (
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
                )}

                {/* Mobile Segment Chapters Navigation */}
                <div className="block lg:hidden">
                  <SegmentNav
                    segments={session.segments}
                    activeSegmentIndex={activeSegmentIndex}
                    completedSegmentIds={completedSegmentIds}
                    onSelectSegment={handleSelectSegment}
                  />
                </div>
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
    </div>
  );
};

export default App;
