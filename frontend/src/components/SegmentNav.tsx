import React from 'react';
import { CheckCircle2, Lock, PlayCircle, Clock, AlertTriangle } from 'lucide-react';
import type { Segment } from '../types';

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

  return (
    <nav aria-label="Topic chapters" className="bg-raised border border-line-soft rounded-2xl p-4 flex flex-col h-full shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-ink uppercase tracking-wider">
          Topic Chapters
        </h2>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-ember-500/10 text-ember-300 border border-ember-500/25">
            {masteredCount}/{segments.length} Mastered ({progressPct}%)
          </span>
          {reviewCount > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/25">
              {reviewCount} Review
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar — ember trail */}
      <div className="w-full h-1.5 bg-cosmos-800 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-to-r from-ember-700 via-ember-600 to-ember-500 shadow-[0_0_10px_rgba(255,81,0,0.45)] transition-all duration-300"
          style={{ width: `${progressPct}%` }}
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
              className={`w-full text-left p-3 min-h-[56px] rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                isActive
                  ? 'bg-ember-600/15 border-ember-500/50 shadow-md shadow-ember-500/10'
                  : needsReview
                  ? 'bg-amber-500/5 border-amber-500/30 hover:border-amber-500/50 hover:bg-amber-500/10'
                  : isCompleted
                  ? 'bg-raised/60 border-line-soft hover:border-line hover:bg-sunken/60'
                  : 'bg-sunken/40 border-line-soft/40 opacity-50 cursor-not-allowed'
              }`}
            >
              {/* Status Icon */}
              <div className="mt-0.5 flex-shrink-0">
                {needsReview ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                ) : isCompleted ? (
                  <CheckCircle2 className="w-4 h-4 text-success" />
                ) : isActive ? (
                  <PlayCircle className="w-4 h-4 text-ember-400 animate-pulse" />
                ) : (
                  <Lock className="w-4 h-4 text-cosmos-600" />
                )}
              </div>

              {/* Keyframe thumbnail (Gemini vision) — appears once enrichment lands */}
              {seg.keyframe_url && (
                <img
                  src={seg.keyframe_url}
                  alt=""
                  loading="lazy"
                  className="w-14 h-9 rounded-md object-cover border border-line-soft bg-black flex-shrink-0"
                />
              )}

              {/* Title & Metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span
                    className={`text-xs font-semibold truncate ${
                      isActive
                        ? 'text-ember-200'
                        : needsReview
                        ? 'text-amber-300'
                        : isCompleted
                        ? 'text-ink-muted'
                        : 'text-ink-faint'
                    }`}
                  >
                    {seg.title}
                  </span>

                  {needsReview && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex-shrink-0">
                      Review
                    </span>
                  )}
                  {isCompleted && !needsReview && (
                    <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-success/15 text-success border border-success/30 flex-shrink-0">
                      Mastered
                    </span>
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
