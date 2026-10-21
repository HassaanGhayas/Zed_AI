import React, { useEffect, useState } from 'react';
import { Cloud, PlayCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchCloudSessions, rowToPersisted } from '../lib/cloudSync';
import type { PersistedSession } from '../lib/persistence';
import type { CloudSessionRow } from '../types';

interface CloudLibraryProps {
  onResume: (session: PersistedSession) => void;
}

/**
 * Landing-page list of the signed-in user's cloud sessions so a study session
 * started on another device can be resumed here. Renders nothing when signed
 * out, when Supabase is unset, or when there is nothing resumable.
 */
export const CloudLibrary: React.FC<CloudLibraryProps> = ({ onResume }) => {
  const { user } = useAuth();
  const userId = user?.id;
  const [items, setItems] = useState<{ row: CloudSessionRow; persisted: PersistedSession }[]>([]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    fetchCloudSessions().then((rows) => {
      if (!alive || !rows) return;
      const resumable = rows.flatMap((row) => {
        const persisted = rowToPersisted(row);
        return persisted ? [{ row, persisted }] : [];
      });
      setItems(resumable.slice(0, 6));
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  if (!userId || items.length === 0) return null; // items are stale after sign-out, so gate on userId

  return (
    <section aria-label="Resume from your cloud library" className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-6">
      <div className="p-4 rounded-lg bg-raised border border-line-soft shadow-card space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink-faint flex items-center gap-1.5">
          <Cloud className="w-3.5 h-3.5 text-accent" /> Continue where you left off
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {items.map(({ row, persisted }) => {
            const total = persisted.session.segments.length;
            const done = persisted.completedSegmentIds.length;
            return (
              <button
                key={row.client_session_id}
                type="button"
                onClick={() => onResume(persisted)}
                className="p-3 min-h-[44px] rounded-md bg-sunken border border-line-soft hover:border-accent/40 flex items-center justify-between gap-2 text-left transition-colors cursor-pointer"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink truncate">{row.lecture_title}</span>
                  <span className="block text-xs text-ink-faint">
                    {done} / {total} topics · {row.status === 'complete' ? 'Completed' : 'In Progress'}
                  </span>
                </span>
                <PlayCircle className="w-5 h-5 text-accent flex-shrink-0" aria-hidden="true" />
                <span className="sr-only">Resume</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
};
