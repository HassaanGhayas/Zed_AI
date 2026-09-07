import React from 'react';
import {
  Sparkles,
  BookOpen,
  Clock,
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
  activeQuestionIndex: _activeQuestionIndex,
  totalQuestionsInSegment: _totalQuestionsInSegment,
  hasEvaluationResult = false,
  isCorrect = false,
  needsReview = false,
  onSelectSegment,
}) => {
  const currentSegment = segments[activeSegmentIndex];
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

  const STAGES: { id: TutorStage; label: string }[] = [
    { id: 'WATCHING', label: 'Watch' },
    { id: 'ACTIVE_RECALL', label: 'Recall' },
    { id: 'REVIEW', label: 'Review' },
    { id: 'COMPLETE', label: 'Mastered' },
  ];

  const formatSeconds = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <aside className="bg-raised border border-line-soft rounded-2xl p-4 flex flex-col gap-3.5 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-line-soft">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-ember-600 to-amber-500 text-white flex items-center justify-center shadow-md shadow-ember-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink">AI Tutor Guidance</h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  stage === 'ACTIVE_RECALL'
                    ? 'bg-ember-400 animate-pulse'
                    : stage === 'REVIEW'
                    ? 'bg-amber-400 animate-pulse'
                    : stage === 'COMPLETE'
                    ? 'bg-success'
                    : 'bg-ember-500 animate-pulse'
                }`}
              />
              <span className="text-[11px] font-medium text-ink-muted">
                {stage === 'ACTIVE_RECALL'
                  ? 'Active Recall Check'
                  : stage === 'REVIEW'
                  ? 'Review Needed'
                  : stage === 'COMPLETE'
                  ? 'All Complete'
                  : 'Lecture Streaming'}
              </span>
            </div>
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

      {/* Sleek Stage Pipeline */}
      <div className="flex items-center justify-between gap-1 p-1 rounded-xl bg-sunken/50 border border-line-soft text-[11px]">
        {STAGES.map((s) => {
          const isCurrent = stage === s.id;
          const isPassed =
            (s.id === 'WATCHING' && (stage === 'ACTIVE_RECALL' || stage === 'REVIEW' || stage === 'COMPLETE')) ||
            (s.id === 'ACTIVE_RECALL' && (stage === 'REVIEW' || stage === 'COMPLETE')) ||
            (s.id === 'REVIEW' && stage === 'COMPLETE');

<<<<<<< HEAD
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
=======
          return (
            <div
              key={s.id}
              className={`flex-1 py-1 rounded-lg text-center font-medium transition-all ${
                isCurrent
                  ? 'bg-ember-500/20 text-ember-300 font-semibold border border-ember-500/30'
                  : isPassed
                  ? 'text-success font-normal bg-success/5'
                  : 'text-ink-faint'
              }`}
            >
              {s.label}
>>>>>>> b76a893 (Work in progress: contributor changes)
            </div>
          );
        })}
      </div>

      {/* Current Chapter Focus Card */}
      {currentSegment && (
        <div className="p-3.5 rounded-xl bg-sunken/40 border border-line-soft space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-ember-400 flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5" />
              Chapter {activeSegmentIndex + 1} of {totalSegments}
            </span>
            <span className="text-ink-faint font-mono flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatSeconds(currentSegment.start_time)} - {formatSeconds(currentSegment.end_time)}
            </span>
          </div>

          <h4 className="text-sm font-bold text-ink leading-snug">
            {currentSegment.title}
          </h4>

          {/* Contextual Status Guidance */}
          <div
            className={`p-2.5 rounded-lg text-xs leading-relaxed ${
              stage === 'ACTIVE_RECALL'
                ? 'bg-ember-500/10 border border-ember-500/25 text-ember-200'
                : stage === 'REVIEW'
                ? 'bg-amber-500/10 border border-amber-500/25 text-amber-200'
                : stage === 'COMPLETE'
                ? 'bg-success/10 border border-success/25 text-success'
                : 'bg-raised/80 border border-line-soft text-ink-muted'
            }`}
          >
            {stage === 'COMPLETE' ? (
              <span>🎉 All chapters finished! View your synthesized notes and mastery analytics.</span>
            ) : stage === 'ACTIVE_RECALL' ? (
              hasEvaluationResult && isCorrect ? (
                <span>✓ Concept mastered! Proceed to continue video playback.</span>
              ) : (
                <span>✍️ Video paused: Answer the active recall prompt in the player to proceed.</span>
              )
            ) : stage === 'REVIEW' ? (
              <span>⚠️ Flagged for review. You can continue advancing through the lecture.</span>
            ) : (
              <span>
                ⏱ Video will automatically pause at <strong>{formatSeconds(currentSegment.end_time)}</strong> for a concept check.
              </span>
            )}
          </div>
        </div>
      )}

      {/* Chapter Quick Navigation */}
      {segments.length > 1 && onSelectSegment && (
<<<<<<< HEAD
        <div className="pt-2 border-t border-line-soft/80 flex items-center justify-between gap-2 text-xs">
=======
        <div className="pt-2 border-t border-line-soft/60 flex items-center justify-between text-xs">
>>>>>>> b76a893 (Work in progress: contributor changes)
          <button
            type="button"
            disabled={activeSegmentIndex === 0}
            onClick={() => onSelectSegment(activeSegmentIndex - 1)}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-line-soft text-ink-faint hover:text-ink hover:bg-sunken disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center"
          >
            ← Prev
          </button>
          <span className="text-[11px] text-ink-faint font-mono">
            Chapter {activeSegmentIndex + 1} / {segments.length}
          </span>
          <button
            type="button"
            disabled={activeSegmentIndex >= segments.length - 1}
            onClick={() => onSelectSegment(activeSegmentIndex + 1)}
            className="px-3 py-2 min-h-[44px] rounded-lg border border-line-soft text-ink-faint hover:text-ink hover:bg-sunken disabled:opacity-30 disabled:pointer-events-none transition-all cursor-pointer flex items-center justify-center"
          >
            Next →
          </button>
        </div>
      )}
    </aside>
  );
};
