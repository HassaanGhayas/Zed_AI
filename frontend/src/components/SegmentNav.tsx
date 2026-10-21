import React from 'react';
import { CheckCircle2, Lock, PlayCircle, Clock, AlertTriangle } from 'lucide-react';
import type { Segment } from '../types';
import { Badge } from './ui/Badge';

interface SegmentNavProps {
  segments: Segment[];
  activeSegmentIndex: number;
  completedSegmentIds: Set<number>;
  needsReviewSegmentIds?: Set<number>;
  unlockedUpTo: number;
  onSelectSegment: (index: number) => void;
}

export const SegmentNav: React.FC<SegmentNavProps> = ({
  segments,
  activeSegmentIndex,
  completedSegmentIds,
  needsReviewSegmentIds = new Set(),
  unlockedUpTo,
  onSelectSegment,
}) => {
  const formatSeconds = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const completedCount = completedSegmentIds.size;
  const reviewCount = Array.from(completedSegmentIds).filter((id) => needsReviewSegmentIds.has(id)).length;
  const masteredCount = completedCount - reviewCount;
  const progressPct = Math.round((completedCount / Math.max(1, segments.length)) * 100);
  const safePct = Number.isFinite(progressPct) ? Math.min(100, Math.max(0, progressPct)) : 0;

  return (
    <nav aria-label="Topic chapters" className="bg-raised border border-line-soft shadow-card rounded-lg p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-ink uppercase tracking-wider">
          Topic Chapters
        </h2>
        <div className="flex items-center gap-1.5">
          <Badge tone="accent">
            {masteredCount}/{segments.length} Mastered ({progressPct}%)
          </Badge>
          {reviewCount > 0 && (
            <Badge tone="warning">
              {reviewCount} Review
            </Badge>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div
        role="progressbar"
        aria-label="Chapters completed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={safePct}
        className="mb-4 h-2 rounded-full bg-line overflow-hidden"
      >
        <div
          className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-500 ease-out"
          style={{ transform: `scaleX(${safePct / 100})` }}
        />
      </div>

      {/* Segment Cards List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
        {segments.map((seg, idx) => {
          const isCompleted = completedSegmentIds.has(seg.segment_id);
          const needsReview = needsReviewSegmentIds.has(seg.segment_id);
          const isActive = idx === activeSegmentIndex;
          // Locked = never reached this session. Revisiting earlier chapters must
          // not re-lock forward ones, so this uses the high-water mark, not the
          // current active index.
          const isLocked = !isCompleted && idx > unlockedUpTo;

          return (
            <button
              key={seg.segment_id}
              disabled={isLocked}
              aria-current={isActive ? 'step' : undefined}
              onClick={() => onSelectSegment(idx)}
              className={`w-full text-left p-3 min-h-[56px] rounded-lg border transition-colors flex items-start gap-3 cursor-pointer ${
                isActive
                  ? 'bg-accent/10 border-accent/50'
                  : needsReview
                  ? 'bg-warning/5 border-warning/30 hover:border-warning/50 hover:bg-warning/10'
                  : isCompleted
                  ? 'bg-raised/60 border-line-soft hover:border-line hover:bg-sunken/60'
                  : 'bg-sunken/40 border-line-soft/40 opacity-50 cursor-not-allowed'
              }`}
            >
              {/* Status Icon */}
              <div className="mt-0.5 flex-shrink-0">
                {needsReview ? (
                  <AlertTriangle className="w-4 h-4 text-warning" />
                ) : isCompleted ? (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                ) : isActive ? (
                  <PlayCircle className="w-4 h-4 text-accent" />
                ) : (
                  <Lock className="w-4 h-4 text-ink-faint" />
                )}
              </div>

              {/* Keyframe thumbnail (Gemini vision) — appears once enrichment lands */}
              {seg.keyframe_url && (
                <img
                  src={seg.keyframe_url}
                  alt=""
                  loading="lazy"
                  className="w-14 h-9 rounded-md object-cover border border-line-soft bg-sunken flex-shrink-0"
                />
              )}

              {/* Title & Metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span
                    className={`text-xs font-semibold truncate ${
                      isActive
                        ? 'text-ink'
                        : needsReview
                        ? 'text-warning'
                        : isCompleted
                        ? 'text-ink-muted'
                        : 'text-ink-faint'
                    }`}
                  >
                    {seg.title}
                  </span>

                  {needsReview && (
                    <Badge tone="warning" className="flex-shrink-0">
                      Review
                    </Badge>
                  )}
                  {isCompleted && !needsReview && (
                    <Badge tone="success" className="flex-shrink-0">
                      Mastered
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="font-mono">
                    {formatSeconds(seg.start_time)} - {formatSeconds(seg.end_time)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
