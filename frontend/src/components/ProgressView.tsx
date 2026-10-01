import React, { useState } from 'react';
import {
  X,
  PieChart,
  CheckCircle2,
  AlertTriangle,
  Award,
  BookOpen,
} from 'lucide-react';
import type { Segment, QAHistoryItem } from '../types';
import { getSessionHistory } from '../lib/sessionHistory';
import { Modal } from './ui/Modal';
import { Badge } from './ui/Badge';

interface ProgressViewProps {
  isOpen: boolean;
  onClose: () => void;
  videoTitle: string;
  videoId?: string;
  segments: Segment[];
  completedSegmentIds: Set<number>;
  needsReviewSegmentIds: Set<number>;
  qaHistory: QAHistoryItem[];
  onOpenNotes?: () => void;
}

type OutcomeType = 'first' | 'retry' | 'review';

// Colors resolve via CSS custom properties so the donut/legend/bars stay
// correct across both themes instead of baking in one theme's hex value.
const OUTCOME_META: Record<OutcomeType, { label: string; color: string; bg: string }> = {
  first: { label: 'Passed 1st Try', color: 'var(--color-success)', bg: 'bg-success/10 text-success border-success/30' },
  retry: { label: 'Passed After Retry', color: 'var(--color-accent)', bg: 'bg-ember-500/10 text-ember-300 border-ember-500/25' },
  review: { label: 'Needs Review', color: 'var(--color-warning)', bg: 'bg-warning/10 text-warning border-warning/30' },
};

export const ProgressView: React.FC<ProgressViewProps> = ({
  isOpen,
  onClose,
  videoTitle,
  segments,
  completedSegmentIds,
  needsReviewSegmentIds,
  qaHistory,
  onOpenNotes,
}) => {
  const [activeSlice, setActiveSlice] = useState<OutcomeType | null>(null);
  const [selectedTopicIdx, setSelectedTopicIdx] = useState<number | null>(null);

  if (!isOpen) return null;

  const pastSessions = getSessionHistory();

  // Aggregate per-segment performance metrics
  const segmentPerf = segments.map((seg, idx) => {
    const isReview = needsReviewSegmentIds.has(seg.segment_id);
    const qas = qaHistory.filter((q) => q.segment_title === seg.title);
    // A segment with any recorded answer is never "Unreached" — qaHistory is
    // the ground truth for whether a checkpoint was actually attempted,
    // completedSegmentIds is derived from it and can lag or miss a reconcile
    // (e.g. state restored from an older persisted session).
    const isCompleted = completedSegmentIds.has(seg.segment_id) || qas.length > 0;

    const maxAttempts = qas.length > 0 ? Math.max(...qas.map((q) => q.attempts || 1)) : 0;
    const avgScore =
      qas.length > 0
        ? Math.round(qas.reduce((acc, q) => acc + (q.score || (q.needs_review ? 40 : 85)), 0) / qas.length)
        : isCompleted
        ? isReview
          ? 45
          : 90
        : 0;

    let outcome: OutcomeType = 'first';
    if (isReview) {
      outcome = 'review';
    } else if (maxAttempts > 1) {
      outcome = 'retry';
    } else {
      outcome = 'first';
    }

    return {
      index: idx,
      segmentId: seg.segment_id,
      title: seg.title,
      isCompleted,
      isReview,
      attempts: maxAttempts,
      score: avgScore,
      outcome,
      qas,
    };
  });

  const attemptedSegments = segmentPerf.filter((s) => s.isCompleted);
  const totalSegments = segments.length;
  // Same reconciliation as isCompleted above, applied to the header stats so
  // "Chapters Finished" can't undercount relative to the per-chapter rows.
  const completedCount = attemptedSegments.length;
  const reviewCount = attemptedSegments.filter((s) => s.isReview).length;
  const masteredFirstTryCount = attemptedSegments.filter((s) => s.outcome === 'first').length;
  const masteredRetryCount = attemptedSegments.filter((s) => s.outcome === 'retry').length;

  const overallProgressPct =
    totalSegments > 0 ? Math.round((completedCount / totalSegments) * 100) : 0;

  // Aggregate all validated concepts and misconceptions across qaHistory
  const strongConcepts = Array.from(
    new Set(
      qaHistory
        .flatMap((q) => q.understood_concepts || [])
        .filter(Boolean)
    )
  );

  const weakConcepts = Array.from(
    new Set(
      [
        ...qaHistory.flatMap((q) => q.misconceptions || []),
        ...qaHistory.flatMap((q) => q.missing_concepts || []),
      ].filter(Boolean)
    )
  );

  const totalConcepts = strongConcepts.length + weakConcepts.length;
  const masteryRatio = totalConcepts > 0 ? Math.round((strongConcepts.length / totalConcepts) * 100) : 100;

  // Donut SVG geometry
  const outcomeCounts: Record<OutcomeType, number> = {
    first: masteredFirstTryCount,
    retry: masteredRetryCount,
    review: reviewCount,
  };
  const totalAttempted = attemptedSegments.length;
  const RADIUS = 54;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  let accumulatedLength = 0;
  const donutSlices: { key: OutcomeType; count: number; len: number; offset: number }[] = (
    ['first', 'retry', 'review'] as OutcomeType[]
  )
    .map((key) => {
      const count = outcomeCounts[key];
      const len = totalAttempted > 0 ? (count / totalAttempted) * CIRCUMFERENCE : 0;
      const slice = { key, count, len, offset: accumulatedLength };
      accumulatedLength += len;
      return slice;
    })
    .filter((s) => s.count > 0);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      titleId="progress-view-title"
      className="max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden my-auto"
      overlayClassName="!bg-black/75 !backdrop-blur-md !p-3 sm:!p-6 overflow-y-auto overflow-x-hidden"
    >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-line-soft flex items-center justify-between bg-sunken/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-ember-600 to-warning text-white flex items-center justify-center shadow-lg shadow-ember-500/25">
              <PieChart className="w-5 h-5" />
            </div>
            <div>
              <h2 id="progress-view-title" className="text-lg font-bold text-ink tracking-tight">
                Learning & Mastery Dashboard
              </h2>
              <p className="text-xs text-ink-faint truncate max-w-md">
                {videoTitle || 'Lecture Analytics'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onOpenNotes && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenNotes();
                }}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-ember-500/10 text-ember-300 border border-ember-500/25 hover:bg-ember-500/20 transition-all cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Study Notes</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dashboard"
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-ink-faint hover:text-ink hover:bg-sunken border border-line-soft transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* Chapters Completed */}
            <div className="p-4 rounded-xl bg-sunken/60 border border-line-soft flex flex-col justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                Chapters Finished
              </span>
              <div className="mt-2 mb-1 flex items-baseline gap-1">
                <span className="text-2xl sm:text-3xl font-bold font-display text-ink">
                  {completedCount}
                </span>
                <span className="text-xs text-ink-faint font-medium">/ {totalSegments}</span>
              </div>
              <div className="w-full h-1 bg-cosmos-800 rounded-full overflow-hidden mt-1">
                <div
                  className="h-full bg-success transition-all duration-300"
                  style={{ width: `${overallProgressPct}%` }}
                />
              </div>
            </div>

            {/* Overall Understanding */}
            <div className="p-4 rounded-xl bg-sunken/60 border border-line-soft flex flex-col justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                Progress Ratio
              </span>
              <div className="mt-2 mb-1 flex items-baseline gap-1">
                <span className="text-2xl sm:text-3xl font-bold font-display text-ember-300">
                  {overallProgressPct}%
                </span>
              </div>
              <p className="text-[11px] text-ink-faint">Through lecture checkpoints</p>
            </div>

            {/* Topics Needing Review */}
            <div className="p-4 rounded-xl bg-sunken/60 border border-line-soft flex flex-col justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                Needs Review
              </span>
              <div className="mt-2 mb-1 flex items-baseline gap-1">
                <span
                  className={`text-2xl sm:text-3xl font-bold font-display ${
                    reviewCount > 0 ? 'text-warning' : 'text-ink'
                  }`}
                >
                  {reviewCount}
                </span>
                <span className="text-xs text-ink-faint">Topics</span>
              </div>
              <p className="text-[11px] text-ink-faint">
                {reviewCount > 0 ? 'Exhausted retries during quiz' : 'All checkpoints cleared'}
              </p>
            </div>

            {/* Concept Mastery Ratio */}
            <div className="p-4 rounded-xl bg-sunken/60 border border-line-soft flex flex-col justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-ink-faint">
                Concept Ratio
              </span>
              <div className="mt-2 mb-1 flex items-baseline gap-1">
                <span className="text-2xl sm:text-3xl font-bold font-display text-success">
                  {masteryRatio}%
                </span>
              </div>
              <p className="text-[11px] text-ink-faint">
                {strongConcepts.length} mastered vs {weakConcepts.length} gap
              </p>
            </div>
          </div>

          {/* Performance & Donut Visualization */}
          <div className="p-5 rounded-xl bg-sunken/40 border border-line-soft flex flex-col lg:flex-row gap-6 items-center">
            {/* SVG Donut Chart */}
            <div className="flex flex-col items-center justify-center flex-shrink-0">
              <svg
                className="w-40 h-40"
                viewBox="0 0 140 140"
                role="img"
                aria-label="Checkpoint outcome distribution chart"
              >
                {donutSlices.length === 0 ? (
                  <circle
                    cx="70"
                    cy="70"
                    r={RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="16"
                    className="text-cosmos-800"
                  />
                ) : (
                  donutSlices.map((slice) => {
                    const arcLen = Math.max(slice.len - 2, 0);
                    const isDim = activeSlice && activeSlice !== slice.key;
                    const isFocus = activeSlice === slice.key;

                    return (
                      <circle
                        key={slice.key}
                        cx="70"
                        cy="70"
                        r={RADIUS}
                        fill="none"
                        stroke={OUTCOME_META[slice.key].color}
                        strokeWidth={isFocus ? 20 : 16}
                        strokeDasharray={`${arcLen} ${CIRCUMFERENCE - arcLen}`}
                        strokeDashoffset={-slice.offset}
                        transform="rotate(-90 70 70)"
                        className={`transition-all duration-200 cursor-pointer ${
                          isDim ? 'opacity-30' : 'opacity-100'
                        }`}
                        onMouseEnter={() => setActiveSlice(slice.key)}
                        onMouseLeave={() => setActiveSlice(null)}
                        onClick={() => setActiveSlice((k) => (k === slice.key ? null : slice.key))}
                      />
                    );
                  })
                )}
                <text
                  x="70"
                  y="67"
                  textAnchor="middle"
                  className="fill-current text-ink font-bold font-display text-xl"
                >
                  {activeSlice ? outcomeCounts[activeSlice] : totalAttempted}
                </text>
                <text
                  x="70"
                  y="83"
                  textAnchor="middle"
                  className="fill-current text-ink-faint text-[10px] uppercase tracking-wider font-semibold"
                >
                  {activeSlice ? OUTCOME_META[activeSlice].label : 'Topics'}
                </text>
              </svg>

              {/* Donut Legend */}
              <div className="flex flex-wrap items-center justify-center gap-2.5 mt-3 text-xs">
                {(['first', 'retry', 'review'] as OutcomeType[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setActiveSlice((cur) => (cur === k ? null : k))}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md transition-all cursor-pointer ${
                      activeSlice === k
                        ? 'bg-raised shadow-sm font-semibold'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: OUTCOME_META[k].color }}
                    />
                    <span>{OUTCOME_META[k].label}:</span>
                    <span className="font-bold text-ink">{outcomeCounts[k]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Per-Topic Performance Bars */}
            <div className="flex-1 w-full space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-ink-muted">
                  Chapter Mastery Scores
                </h4>
                <span className="text-[11px] text-ink-faint">
                  Click any topic to inspect details
                </span>
              </div>

              {segmentPerf.length === 0 ? (
                <div className="py-6 flex flex-col items-center gap-1.5 text-center text-ink-faint">
                  <BookOpen className="w-6 h-6 text-ink-faint/60" />
                  <p className="text-xs">No chapters loaded yet.</p>
                  <p className="text-[11px] text-ink-faint/80">Start watching the video to populate chapter mastery scores here.</p>
                </div>
              ) : (
                segmentPerf.map((t) => {
                  const isSelected = selectedTopicIdx === t.index;
                  return (
                    <div key={t.segmentId} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => setSelectedTopicIdx((cur) => (cur === t.index ? null : t.index))}
                        className={`w-full text-left p-2 rounded-xl border transition-all flex items-center gap-3 cursor-pointer ${
                          isSelected
                            ? 'bg-raised border-ember-500/50 shadow-sm'
                            : 'bg-raised/40 border-line-soft hover:bg-sunken/60'
                        }`}
                      >
                        <span className="w-5 text-center text-xs font-bold text-ink-faint">
                          {t.index + 1}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-ink truncate">
                              {t.title}
                            </span>
                            <span className="text-xs font-bold font-mono text-ink ml-2">
                              {t.isCompleted ? `${t.score}%` : 'Unreached'}
                            </span>
                          </div>

                          <div className="w-full h-1.5 bg-cosmos-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${t.isCompleted ? Math.min(100, Math.max(10, t.score)) : 0}%`,
                                backgroundColor: OUTCOME_META[t.outcome].color,
                              }}
                            />
                          </div>
                        </div>
                      </button>

                      {isSelected && (
                        <div className="p-3 rounded-lg bg-raised border border-line-soft text-xs space-y-1 animate-in fade-in duration-100">
                          <p className="text-ink font-semibold">{t.title}</p>
                          <div className="flex flex-wrap gap-2 text-[11px] text-ink-muted">
                            <span>
                              Best Score: <strong>{t.score}/100</strong>
                            </span>
                            <span>•</span>
                            <span>
                              Attempts: <strong>{t.attempts || 1}</strong>
                            </span>
                            <span>•</span>
                            <span>
                              Status: <strong style={{ color: OUTCOME_META[t.outcome].color }}>{OUTCOME_META[t.outcome].label}</strong>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Concept Mastery Split Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Strong Concepts */}
            <div className="p-4 rounded-xl bg-sunken/50 border border-line-soft space-y-2.5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-success">
                  Strong Concepts Mastered ({strongConcepts.length})
                </h4>
              </div>
              <p className="text-xs text-ink-faint">
                Ideas and mechanisms you accurately articulated during recall:
              </p>
              {strongConcepts.length === 0 ? (
                <div className="py-4 flex flex-col items-center gap-1.5 text-center text-ink-faint">
                  <CheckCircle2 className="w-6 h-6 text-ink-faint/60" />
                  <p className="text-xs italic">Answer conceptual questions correctly to record mastered concepts.</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {strongConcepts.map((c, i) => (
                    <Badge key={i} tone="success" className="rounded-lg! font-medium! px-2.5! py-1! text-xs!">
                      <CheckCircle2 className="w-3 h-3" /> {c}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Concepts Needing Improvement */}
            <div className="p-4 rounded-xl bg-sunken/50 border border-line-soft space-y-2.5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-warning" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-warning">
                  Concepts to Revisit ({weakConcepts.length})
                </h4>
              </div>
              <p className="text-xs text-ink-faint">
                Identified misconceptions or missing details to review before exams:
              </p>
              {weakConcepts.length === 0 ? (
                <div className="py-4 flex flex-col items-center gap-1.5 text-center text-ink-faint">
                  <Award className="w-6 h-6 text-ink-faint/60" />
                  <p className="text-xs italic">No misconceptions flagged! Great job on your first attempts.</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
                  {weakConcepts.map((m, i) => (
                    <Badge key={i} tone="warning" className="rounded-lg! font-medium! px-2.5! py-1! text-xs!">
                      <AlertTriangle className="w-3 h-3" /> {m}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Session History Across Videos */}
          {pastSessions.length > 0 && (
            <div className="p-4 rounded-xl bg-sunken/30 border border-line-soft space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-ink-faint flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-ember-400" /> Recent Learning Sessions
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {pastSessions.slice(0, 4).map((s) => (
                  <div
                    key={s.sessionId}
                    className="p-3 rounded-lg bg-raised/70 border border-line-soft flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink truncate">
                        {s.lectureTitle}
                      </p>
                      <p className="text-[10px] text-ink-faint">
                        {s.completedTopics} / {s.totalTopics} topics ·{' '}
                        {s.status === 'complete' ? (
                          <span className="text-success font-medium">Completed</span>
                        ) : (
                          <span>In Progress</span>
                        )}
                      </p>
                    </div>
                    <span className="text-xs font-mono font-bold text-ember-300">
                      {s.totalTopics > 0 ? `${Math.round((s.completedTopics / s.totalTopics) * 100)}%` : '0%'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-line-soft bg-sunken/50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 min-h-[40px] text-xs sm:text-sm font-semibold text-ink-muted hover:text-ink rounded-xl border border-line-soft bg-sunken hover:bg-line-soft transition-all cursor-pointer"
          >
            Close Dashboard
          </button>
        </div>
    </Modal>
  );
};
