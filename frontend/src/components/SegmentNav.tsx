import React from 'react';
import { CheckCircle2, Lock, PlayCircle, Clock } from 'lucide-react';
import type { Segment } from '../types';

interface SegmentNavProps {
  segments: Segment[];
  activeSegmentIndex: number;
  completedSegmentIds: Set<number>;
  onSelectSegment: (index: number) => void;
}

export const SegmentNav: React.FC<SegmentNavProps> = ({
  segments,
  activeSegmentIndex,
  completedSegmentIds,
  onSelectSegment,
}) => {
  const formatSeconds = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const completedCount = completedSegmentIds.size;
  const progressPct = Math.round((completedCount / Math.max(1, segments.length)) * 100);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col h-full shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Topic Chapters
        </h3>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
          {completedCount} / {segments.length} Mastered ({progressPct}%)
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Segment Cards List */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
        {segments.map((seg, idx) => {
          const isCompleted = completedSegmentIds.has(seg.segment_id);
          const isActive = idx === activeSegmentIndex;
          const isLocked = !isCompleted && !isActive && idx > activeSegmentIndex;

          return (
            <button
              key={seg.segment_id}
              disabled={isLocked}
              onClick={() => onSelectSegment(idx)}
              className={`w-full text-left p-3 rounded-xl border transition-all flex items-start gap-3 cursor-pointer ${
                isActive
                  ? 'bg-blue-600/15 border-blue-500/50 shadow-md shadow-blue-500/5'
                  : isCompleted
                  ? 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                  : 'bg-slate-950/40 border-slate-800/40 opacity-50 cursor-not-allowed'
              }`}
            >
              {/* Status Icon */}
              <div className="mt-0.5 flex-shrink-0">
                {isCompleted ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : isActive ? (
                  <PlayCircle className="w-4 h-4 text-blue-400 animate-pulse" />
                ) : (
                  <Lock className="w-4 h-4 text-slate-600" />
                )}
              </div>

              {/* Title & Metadata */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <span
                    className={`text-xs font-semibold truncate ${
                      isActive ? 'text-blue-200' : isCompleted ? 'text-slate-200' : 'text-slate-500'
                    }`}
                  >
                    {seg.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <Clock className="w-3 h-3" />
                  <span>
                    {formatSeconds(seg.start_time)} - {formatSeconds(seg.end_time)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
