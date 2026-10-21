import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RotateCcw, CheckCircle2, AlertCircle, SkipForward, ArrowRight, Sparkles, Lightbulb } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { fetchDueQueue } from '../lib/api';
import {
  advance,
  currentItem,
  initReview,
  isDone,
  showResult,
  skip,
  submitReviewAnswer,
  type ReviewState,
} from '../lib/reviewQueue';
import { useActiveStopwatch } from '../hooks/useActiveStopwatch';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { SkeletonLine } from './ui/Skeleton';

interface ReviewQueueProps {
  /** `landing` renders its own page-width section; `panel` fills its parent card. */
  variant?: 'landing' | 'panel';
  /** Called after an answer is graded so a parent can refresh its analytics. */
  onReviewed?: () => void;
}

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; totalDue: number; state: ReviewState };

/**
 * Spaced-repetition queue: re-asks the original question for concepts that are
 * due, grades with the existing evaluator, and records the result. Renders
 * nothing when signed out (or when Supabase is unset).
 */
export const ReviewQueue: React.FC<ReviewQueueProps> = ({ variant = 'panel', onReviewed }) => {
  const { enabled, user } = useAuth();
  const userId = user?.id;
  if (!enabled || !userId) return null;
  return <ReviewQueueBody key={userId} variant={variant} onReviewed={onReviewed} />;
};

const ReviewQueueBody: React.FC<ReviewQueueProps> = ({ variant = 'panel', onReviewed }) => {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const stopwatch = useActiveStopwatch();
  const aliveRef = useRef(true);

  const fetchQueue = useCallback(() => {
    setLoad({ kind: 'loading' });
    fetchDueQueue(20)
      .then((res) => {
        if (!aliveRef.current) return;
        setLoad({ kind: 'ready', totalDue: res.total_due, state: initReview(res.items ?? []) });
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return;
        setLoad({ kind: 'error', message: err instanceof Error ? err.message : 'Could not load your review queue.' });
      });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    fetchQueue();
    return () => {
      aliveRef.current = false;
    };
  }, [fetchQueue]);

  const state = load.kind === 'ready' ? load.state : null;
  const item = state ? currentItem(state) : null;
  const itemKey = item ? item.concept_key : null;

  // A question on screen restarts the timer and counts as study time.
  useEffect(() => {
    if (!itemKey) return;
    setAnswer('');
    setSubmitError(null);
    setShowHint(false);
    stopwatch.restart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  const update = (fn: (s: ReviewState) => ReviewState) =>
    setLoad((l) => (l.kind === 'ready' ? { ...l, state: fn(l.state) } : l));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!item || !answer.trim() || busy) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const ev = await submitReviewAnswer(item, answer.trim(), stopwatch.elapsedMs());
      if (!aliveRef.current) return;
      update((s) => showResult(s, ev));
      onReviewed?.();
    } catch (err) {
      if (aliveRef.current) setSubmitError(err instanceof Error ? err.message : 'Could not grade your answer.');
    } finally {
      if (aliveRef.current) setBusy(false);
    }
  };

  const remaining = load.kind === 'ready' ? Math.max(0, load.totalDue - load.state.reviewed - load.state.skipped) : 0;

  const wrapper = (children: React.ReactNode) =>
    variant === 'landing' ? (
      <section aria-label="Spaced review queue" className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 pt-6">
        <div className="p-4 sm:p-5 rounded-xl bg-sunken/30 border border-line-soft space-y-3">{children}</div>
      </section>
    ) : (
      <section aria-label="Spaced review queue" className="space-y-3">{children}</section>
    );

  const heading = (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <h2 className="text-xs font-bold uppercase tracking-wider text-ink-faint flex items-center gap-1.5">
        <RotateCcw className="w-3.5 h-3.5 text-ember-400" aria-hidden="true" /> Review queue
      </h2>
      {load.kind === 'ready' && load.totalDue > 0 && (
        <Badge tone="warning">{remaining} due</Badge>
      )}
    </div>
  );

  if (load.kind === 'loading') {
    return wrapper(
      <>
        {heading}
        <div className="space-y-2" aria-busy="true" role="status">
          <span className="sr-only">Loading your review queue</span>
          <SkeletonLine className="w-5/6" />
          <SkeletonLine className="w-2/3" />
        </div>
      </>
    );
  }

  if (load.kind === 'error') {
    return wrapper(
      <>
        {heading}
        <div role="alert" className="flex items-start gap-2 text-xs text-danger">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span className="flex-1">{load.message}</span>
          <Button type="button" variant="danger" onClick={fetchQueue} className="px-3! py-1.5! text-xs!">
            Retry
          </Button>
        </div>
      </>
    );
  }

  const done = isDone(load.state);
  if (!item || done) {
    const touched = load.state.reviewed + load.state.skipped > 0;
    return wrapper(
      <>
        {heading}
        <p className="text-sm text-ink-muted flex items-center gap-2" role="status">
          <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" aria-hidden="true" />
          {load.state.items.length === 0
            ? 'Nothing is due for review right now. Keep answering checkpoints and concepts will resurface here as you start to forget them.'
            : touched
              ? `Session finished: ${load.state.reviewed} reviewed${load.state.skipped ? `, ${load.state.skipped} skipped` : ''}.${load.totalDue > load.state.items.length ? ' More are due; check back later.' : ''}`
              : 'All caught up.'}
        </p>
      </>
    );
  }

  const feedback = load.state.phase === 'feedback' ? load.state.result : null;

  return wrapper(
    <>
      {heading}
      <div className="rounded-xl bg-raised/70 border border-line-soft p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap text-[11px] text-ink-faint">
          <span>
            Question {load.state.index + 1} of {load.state.items.length}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{item.segment_title}</span>
          {item.domain && <Badge tone="neutral">{item.domain}</Badge>}
          {item.overdue_days > 0 && <Badge tone="warning">{item.overdue_days}d overdue</Badge>}
        </div>
        <p className="text-base text-ink font-medium leading-relaxed">{item.question}</p>

        {!feedback && item.hints.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowHint((v) => !v)}
              aria-expanded={showHint}
              className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-warning transition-colors cursor-pointer min-h-[44px]"
            >
              <Lightbulb className="w-3.5 h-3.5 text-warning/80" aria-hidden="true" />
              {showHint ? 'Hide hint' : 'Show hint'}
            </button>
            {showHint && (
              <p className="p-3 rounded-lg bg-warning/5 border border-warning/20 text-warning/90 text-xs leading-relaxed">
                {item.hints.join(' ')}
              </p>
            )}
          </div>
        )}

        {feedback ? (
          <div className="space-y-3">
            <div
              role="status"
              aria-live="polite"
              className={`p-3.5 rounded-xl border text-sm ${
                feedback.status === 'CORRECT'
                  ? 'bg-success/10 border-success/30'
                  : 'bg-warning/10 border-warning/30'
              }`}
            >
              <div className="flex items-center gap-2 mb-1 font-semibold">
                {feedback.status === 'CORRECT' ? (
                  <CheckCircle2 className="w-4 h-4 text-success" aria-hidden="true" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-warning" aria-hidden="true" />
                )}
                <span className={feedback.status === 'CORRECT' ? 'text-success' : 'text-warning'}>
                  {feedback.status === 'CORRECT' ? 'Recalled' : feedback.status === 'MISCONCEPTION' ? 'Misconception' : 'Not quite'}
                </span>
                <Badge tone={feedback.status === 'CORRECT' ? 'success' : 'warning'}>Score {feedback.score}/100</Badge>
              </div>
              <p className="text-ink-muted leading-relaxed text-xs sm:text-sm">{feedback.feedback}</p>
            </div>
            <Button type="button" onClick={() => update(advance)} className="w-full sm:w-auto">
              {load.state.index + 1 >= load.state.items.length ? 'Finish' : 'Next question'}
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-2.5">
            <label htmlFor={`review-answer-${variant}`} className="block text-xs font-semibold text-ink-faint">
              Answer from memory:
            </label>
            <textarea
              id={`review-answer-${variant}`}
              rows={3}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={busy}
              placeholder="Explain it in your own words..."
              className="w-full p-3 bg-sunken border border-line/80 rounded-xl text-ink text-sm placeholder-ink-faint focus:outline-none focus:ring-2 focus:ring-ember-500 resize-none disabled:opacity-50"
            />
            {submitError && (
              <p role="alert" className="text-xs text-danger flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" /> {submitError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" loading={busy} disabled={!answer.trim()} className="flex-1 sm:flex-initial">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                {busy ? 'Checking...' : 'Check answer'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => update(skip)}
                aria-label="Skip this question without penalty"
              >
                <SkipForward className="w-4 h-4" aria-hidden="true" /> Skip
              </Button>
            </div>
          </form>
        )}
      </div>
    </>
  );
};
