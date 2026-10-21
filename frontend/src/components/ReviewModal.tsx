import React, { useEffect, useState } from 'react';
import { X, AlertTriangle, BookOpen } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Badge } from './ui/Badge';
import { fetchReviewData, type ReviewSummary } from '../lib/cloudSync';

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Cross-session review: concepts and questions to revisit, aggregated from cloud Q&A attempts. */
export const ReviewModal: React.FC<ReviewModalProps> = ({ isOpen, onClose }) =>
  isOpen ? <ReviewModalBody onClose={onClose} /> : null;

// Mounted only while open, so each open starts loading fresh.
const ReviewModalBody: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [data, setData] = useState<ReviewSummary | null>(null);

  useEffect(() => {
    let alive = true;
    fetchReviewData().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  const empty =
    data && data.missingConcepts.length === 0 && data.misconceptions.length === 0 && data.needsReview.length === 0;

  return (
    <Modal isOpen onClose={onClose} titleId="review-modal-title" className="max-w-2xl w-full max-h-[85vh] flex flex-col">
      <div className="p-5 border-b border-line-soft flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-warning/10 text-warning border border-warning/30">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h3 id="review-modal-title" className="text-lg font-semibold text-ink">Review weak spots</h3>
            <p className="text-xs text-ink-faint">Across all your synced sessions</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close review"
          className="p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md text-ink-faint hover:text-ink hover:bg-sunken cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-5 overflow-y-auto space-y-5" aria-live="polite">
        {!data && <p className="text-sm text-ink-muted">Loading your review items...</p>}
        {empty && (
          <p className="text-sm text-ink-muted">Nothing to review yet. Answer some checkpoint questions and gaps will show up here.</p>
        )}
        {data && data.misconceptions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink-faint flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-danger" /> Misconceptions
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {data.misconceptions.map((m) => (
                <Badge key={m.concept} tone="danger">{m.concept}{m.count > 1 ? ` x${m.count}` : ''}</Badge>
              ))}
            </div>
          </div>
        )}
        {data && data.missingConcepts.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink-faint">Missing concepts</h4>
            <div className="flex flex-wrap gap-1.5">
              {data.missingConcepts.map((m) => (
                <Badge key={m.concept} tone="warning">{m.concept}{m.count > 1 ? ` x${m.count}` : ''}</Badge>
              ))}
            </div>
          </div>
        )}
        {data && data.needsReview.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-ink-faint">Questions to revisit</h4>
            <ul className="space-y-2">
              {data.needsReview.map((q) => (
                <li key={`${q.sessionId}|${q.question}`} className="p-3 rounded-lg bg-sunken border border-line-soft">
                  <p className="text-xs font-semibold text-ink">{q.question}</p>
                  <p className="text-xs text-ink-faint">{q.segmentTitle}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
};
