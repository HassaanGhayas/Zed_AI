import React from 'react';
import {
  Sparkles,
  PlayCircle,
  HelpCircle,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Clock,
  Compass,
} from 'lucide-react';
import type { Segment, TutorStage } from '../types';

interface AiTutorPanelProps {
  segments: Segment[];
  activeSegmentIndex: number;
  completedSegmentIds: Set<number>;
  needsReviewSegmentIds?: Set<number>;
  isPausedForQuiz: boolean;
  activeQuestionIndex: number;
  totalQuestionsInSegment: number;
  hasEvaluationResult?: boolean;
  isCorrect?: boolean;
  needsReview?: boolean;
  onSelectSegment?: (index: number) => void;
}

export const AiTutorPanel: React.FC<AiTutorPanelProps> = ({
  segments,
  activeSegmentIndex,
  completedSegmentIds,
  needsReviewSegmentIds = new Set(),
  isPausedForQuiz,
  activeQuestionIndex,
  totalQuestionsInSegment,
  hasEvaluationResult = false,
  isCorrect = false,
  needsReview = false,
  onSelectSegment,
}) => {
  const currentSegment = segments[activeSegmentIndex];
  const nextSegment = segments[activeSegmentIndex + 1];
  const totalSegments = segments.length;
  const completedCount = completedSegmentIds.size;
  const reviewCount = Array.from(completedSegmentIds).filter((id) => needsReviewSegmentIds.has(id)).length;
  const isAllComplete = totalSegments > 0 && completedCount >= totalSegments;

  // Determine active tutor stage
  let stage: TutorStage = 'WATCHING';
  if (isAllComplete) {
    stage = 'COMPLETE';
  } else if (isPausedForQuiz) {
    if (needsReview || (hasEvaluationResult && !isCorrect && needsReviewSegmentIds.has(currentSegment?.segment_id))) {
      stage = 'REVIEW';
    } else {
      stage = 'ACTIVE_RECALL';
    }
  } else {
    stage = 'WATCHING';
  }

  const STAGES: { id: TutorStage; label: string; icon: React.ReactNode }[] = [
    { id: 'WATCHING', label: 'Watching', icon: <PlayCircle className="w-3.5 h-3.5" /> },
    { id: 'ACTIVE_RECALL', label: 'Recall Check', icon: <HelpCircle className="w-3.5 h-3.5" /> },
    { id: 'REVIEW', label: 'Review', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
    { id: 'COMPLETE', label: 'Complete', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  ];

  const formatSeconds = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <aside className="bg-raised border border-line-soft rounded-2xl p-4 sm:p-5 flex flex-col gap-4 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-line-soft">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-ember-600 to-amber-500 text-white flex items-center justify-center shadow-md shadow-ember-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink">AI Tutor Guidance</h3>
            <p className="text-[11px] text-ink-faint">Adaptive Learning Assistant</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-ember-500/10 text-ember-700 dark:text-ember-300 border border-ember-500/25">
            {completedCount} / {totalSegments} Done
          </span>
          {reviewCount > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
              {reviewCount} Review
            </span>
          )}
        </div>
      </div>

      {/* Stage Stepper Pipeline */}
      <div className="p-2.5 rounded-xl bg-sunken/60 border border-line-soft/80">
        <div className="flex items-center justify-between text-[11px] font-semibold">
          {STAGES.map((s, idx) => {
            const isCurrent = stage === s.id;
            const isPassed =
              (s.id === 'WATCHING' && (stage === 'ACTIVE_RECALL' || stage === 'REVIEW' || stage === 'COMPLETE')) ||
              (s.id === 'ACTIVE_RECALL' && (stage === 'REVIEW' || stage === 'COMPLETE')) ||
              (s.id === 'REVIEW' && stage === 'COMPLETE');

            return (
              <React.Fragment key={s.id}>
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded-md transition-all ${
                    isCurrent
                      ? 'bg-ember-500/20 text-ember-800 dark:text-ember-300 border border-ember-500/40 shadow-sm'
                      : isPassed
                      ? 'text-success/90 font-medium'
                      : 'text-ink-faint'
                  }`}
                >
                  {s.icon}
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {idx < STAGES.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-ink-faint/40 flex-shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Real-time Status Card with Pulse */}
      <div
        role="status"
        aria-live="polite"
        className={`p-3.5 rounded-xl border flex items-start gap-2.5 transition-all ${
          stage === 'ACTIVE_RECALL'
            ? 'bg-ember-500/10 border-ember-500/30 text-ember-900 dark:text-ember-200'
            : stage === 'REVIEW'
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200'
            : stage === 'COMPLETE'
            ? 'bg-success/10 border-success/30 text-success'
            : 'bg-sunken/80 border-line-soft text-ink-muted'
        }`}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${
            stage === 'ACTIVE_RECALL'
              ? 'bg-ember-400 animate-pulse'
              : stage === 'REVIEW'
              ? 'bg-amber-400 animate-pulse'
              : stage === 'COMPLETE'
              ? 'bg-success'
              : 'bg-cosmos-500 animate-pulse'
          }`}
        />
        <div className="text-xs leading-relaxed flex-1">
          {stage === 'COMPLETE' ? (
            <span>
              <strong className="text-success font-semibold">All Chapters Finished!</strong> You've engaged with all conceptual checkpoints. View your study notes and performance analytics.
            </span>
          ) : stage === 'ACTIVE_RECALL' ? (
            hasEvaluationResult && isCorrect ? (
              <span>
                <strong className="text-success font-semibold">Concept Mastered!</strong> Tap continue to unlock and proceed to the next video chapter.
              </span>
            ) : hasEvaluationResult ? (
              <span>
                <strong className="text-warning font-semibold">Conceptual Refinement:</strong> The tutor identified a misconception. Use the guided question below to sharpen your mental model.
              </span>
            ) : (
              <span>
                <strong className="text-ember-300 font-semibold">Active Checkpoint Active:</strong> The video has paused. Explain the underlying mechanism in your own words to proceed.
              </span>
            )
          ) : stage === 'REVIEW' ? (
            <span>
              <strong className="text-amber-300 font-semibold">Chapter Flagged for Review:</strong> You completed all 3 retry attempts. This chapter is saved to your review list so you can advance.
            </span>
          ) : (
            <span>
              <strong className="text-ink font-semibold">Lecture Streaming:</strong> Watch the current chapter. The AI Tutor will automatically pause at the conceptual checkpoint.
            </span>
          )}
        </div>
      </div>

      {/* Active Chapter Overview */}
      {currentSegment && (
        <div className="p-3.5 rounded-xl bg-sunken/50 border border-line-soft">
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ember-400 flex items-center gap-1">
              <BookOpen className="w-3 h-3" /> Chapter {activeSegmentIndex + 1} of {totalSegments}
            </span>
            <div className="flex items-center gap-1 text-[11px] text-ink-faint font-mono">
              <Clock className="w-3 h-3" />
              <span>{formatSeconds(currentSegment.start_time)} - {formatSeconds(currentSegment.end_time)}</span>
            </div>
          </div>

          <h4 className="text-sm font-semibold text-ink mb-1.5 line-clamp-1">
            {currentSegment.title}
          </h4>

          <p className="text-xs text-ink-faint line-clamp-2 leading-relaxed mb-2">
            {currentSegment.summary}
          </p>

          {currentSegment.questions && currentSegment.questions.length > 0 && (
            <div className="pt-2 border-t border-line-soft/60 flex items-center justify-between text-[11px] text-ink-muted">
              <span>Checkpoint Question {activeQuestionIndex + 1} of {totalQuestionsInSegment}</span>
              {needsReviewSegmentIds.has(currentSegment.segment_id) ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  Needs Review
                </span>
              ) : completedSegmentIds.has(currentSegment.segment_id) ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-success/15 text-success border border-success/30">
                  Mastered
                </span>
              ) : (
                <span className="text-ink-faint">In Progress</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* What Happens Next Guidance Card */}
      <div className="p-3.5 rounded-xl bg-cosmos-900/30 border border-ember-500/20 text-xs">
        <div className="flex items-center gap-1.5 font-bold text-ember-300 mb-1">
          <Compass className="w-3.5 h-3.5 text-ember-400" />
          <span>What Happens Next</span>
        </div>
        <p className="text-ink-muted text-[11px] leading-relaxed">
          {stage === 'COMPLETE'
            ? 'Open "Study Notes" or the "Learning Dashboard" to review your concept breakdown and export your study notes PDF.'
            : isPausedForQuiz
            ? hasEvaluationResult && isCorrect
              ? nextSegment
                ? `Proceeding will resume video playback into Chapter ${activeSegmentIndex + 2}: "${nextSegment.title}".`
                : 'Final chapter complete! Personalized revision notes will be compiled.'
              : 'Answer the active recall question. The tutor will provide instant feedback on understood concepts and misconceptions.'
            : nextSegment
            ? `At ${formatSeconds(currentSegment.end_time)}, playback will pause for conceptual checkpoint #${activeSegmentIndex + 1}.`
            : 'At the end of this final chapter, the active recall evaluation will finalize your session notes.'}
        </p>
      </div>

      {/* Chapter Quick Jumps */}
      {segments.length > 1 && onSelectSegment && (
        <div className="pt-2 border-t border-line-soft/80 flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            disabled={activeSegmentIndex === 0}
            onClick={() => onSelectSegment(activeSegmentIndex - 1)}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-line-soft text-ink-faint hover:text-ink hover:bg-sunken disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center"
          >
            ← Prev Chapter
          </button>
          <span className="text-[11px] text-ink-faint font-mono">
            {activeSegmentIndex + 1} of {segments.length}
          </span>
          <button
            type="button"
            disabled={activeSegmentIndex >= segments.length - 1}
            onClick={() => onSelectSegment(activeSegmentIndex + 1)}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-line-soft text-ink-faint hover:text-ink hover:bg-sunken disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center"
          >
            Next Chapter →
          </button>
        </div>
      )}
    </aside>
  );
};
