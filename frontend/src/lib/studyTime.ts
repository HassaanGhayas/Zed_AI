import { isForbiddenError, postStudyTime } from './api';
import { isAnalyticsAvailable, isSyncActive, markAnalyticsForbidden, trackCloudWrite } from './cloudSync';
import { isSupabaseEnabled } from './supabase';

/**
 * Active study-time tracking. Time counts only while the student is actually
 * studying (video playing, a quiz open, or a review question on screen) AND the
 * document is visible. Whole seconds are flushed to the backend every 30s and
 * on pagehide / tab hide, only while cloud sync is allowed (signed in, not
 * paused, not foreign local data). Nothing but a second count and a date leaves
 * the device.
 *
 * The 'video' and 'quiz' sources stop counting after IDLE_TIMEOUT_MS without
 * user input (pointer / keyboard / scroll) or video-progress events, and resume
 * on activity. The 'review' source (typing an answer) is not idle-limited.
 */

export type ActivitySource = 'video' | 'quiz' | 'review';

export const FLUSH_INTERVAL_MS = 30_000;
/** No input / video progress for this long pauses the video and quiz sources. */
export const IDLE_TIMEOUT_MS = 5 * 60_000;
/** Backend accepts 1..3600 seconds per request. */
export const MAX_SECONDS_PER_POST = 3600;

/** Pure accumulator: counts milliseconds while (any source active) AND visible. */
export class StudyTimeAccumulator {
  private sources = new Set<ActivitySource>();
  private visible = true;
  private lastTick: number | null = null;
  private ms = 0;
  private lastActivity = Number.NEGATIVE_INFINITY;

  constructor(visible = true) {
    this.visible = visible;
  }

  private get running(): boolean {
    return this.visible && this.sources.size > 0;
  }

  /** Countable milliseconds in (from, now]: capped at the idle deadline unless a review is on screen. */
  private elapsed(from: number, now: number): number {
    if (now <= from) return 0;
    if (this.sources.has('review')) return now - from;
    return Math.max(0, Math.min(now, this.lastActivity + IDLE_TIMEOUT_MS) - from);
  }

  /** Banks elapsed time up to `now` and re-evaluates whether the clock should run. */
  private settle(now: number, mutate: () => void): void {
    if (this.running && this.lastTick !== null) {
      this.ms += this.elapsed(this.lastTick, now);
    }
    mutate();
    this.lastTick = this.running ? now : null;
  }

  setSource(source: ActivitySource, active: boolean, now: number): void {
    this.settle(now, () => {
      if (active) {
        this.sources.add(source);
        this.lastActivity = now; // pressing play / opening a quiz is activity
      } else this.sources.delete(source);
    });
  }

  /** User input or video progress: (re)starts the idle window. */
  noteActivity(now: number): void {
    this.settle(now, () => {
      this.lastActivity = now;
    });
  }

  setVisible(visible: boolean, now: number): void {
    this.settle(now, () => {
      this.visible = visible;
    });
  }

  /** Whole seconds accrued so far (does not consume them). */
  peekSeconds(now: number): number {
    let total = this.ms;
    if (this.running && this.lastTick !== null) total += this.elapsed(this.lastTick, now);
    return Math.floor(total / 1000);
  }

  /** Removes and returns whole accrued seconds; the sub-second remainder carries over. */
  takeSeconds(now: number): number {
    this.settle(now, () => {});
    const whole = Math.floor(this.ms / 1000);
    this.ms -= whole * 1000;
    return whole;
  }

  /** Puts seconds back (e.g. a failed upload) so they are retried on the next flush. */
  restoreSeconds(seconds: number): void {
    if (seconds > 0) this.ms += seconds * 1000;
  }

  /** Drops everything accrued (e.g. while sync is not allowed). */
  reset(now: number): void {
    this.ms = 0;
    this.lastTick = this.running ? now : null;
  }
}

/** Local calendar day as YYYY-MM-DD. */
export function localDayString(d: Date = new Date()): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Splits seconds into backend-sized (<= 3600) chunks. */
export function chunkSeconds(total: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(total));
  while (left > 0) {
    const n = Math.min(left, MAX_SECONDS_PER_POST);
    out.push(n);
    left -= n;
  }
  return out;
}

// ── Singleton tracker wired to the document ──

const acc = new StudyTimeAccumulator();
let started = false;
let currentDay = localDayString();
let flushing: Promise<void> = Promise.resolve();

const nowMs = (): number => Date.now();

/** Records user input / video progress so the video and quiz sources stay counted (cheap; safe to call often). */
export function noteStudyActivity(): void {
  acc.noteActivity(nowMs());
}

/** Mark a study activity source as active/inactive (safe to call before the tracker starts). */
export function setStudyActivity(source: ActivitySource, active: boolean): void {
  acc.setSource(source, active, nowMs());
}

/**
 * Flushes accrued whole seconds. Drops them when sync is not allowed, so time
 * studied while signed out is never uploaded later. Failed uploads are restored.
 */
export function flushStudyTime(opts: { keepalive?: boolean } = {}): Promise<void> {
  const now = nowMs();
  const today = localDayString(new Date(now));
  const day = currentDay;
  currentDay = today;

  if (!isSyncActive() || !isAnalyticsAvailable()) {
    acc.takeSeconds(now);
    return flushing;
  }
  const seconds = acc.takeSeconds(now);
  if (seconds <= 0) return flushing;

  // Tracked so "delete my data" can await it; each chunk re-checks that writes are
  // still allowed, so nothing new is posted after pauseSync().
  flushing = trackCloudWrite(
    flushing.then(async () => {
      let sent = 0;
      try {
        for (const chunk of chunkSeconds(seconds)) {
          if (!isSyncActive() || !isAnalyticsAvailable()) return; // paused/forbidden: drop the rest
          await postStudyTime(chunk, day, opts);
          sent += chunk;
        }
      } catch (err) {
        if (isForbiddenError(err)) markAnalyticsForbidden(); // not available: no retry loop
        else acc.restoreSeconds(seconds - sent);
      }
    })
  );
  return flushing;
}

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart'] as const;

/** Starts the interval + visibility/pagehide listeners. Returns a stop function. No-op when Supabase is unset. */
export function startStudyTimeTracking(): () => void {
  if (!isSupabaseEnabled || started || typeof document === 'undefined') return () => {};
  started = true;
  acc.setVisible(document.visibilityState !== 'hidden', nowMs());
  currentDay = localDayString();

  const timer = setInterval(() => {
    void flushStudyTime();
  }, FLUSH_INTERVAL_MS);
  const onVisibility = () => {
    const hidden = document.visibilityState === 'hidden';
    if (hidden) {
      // Bank the time up to now before the clock stops, then upload it.
      acc.setVisible(false, nowMs());
      void flushStudyTime({ keepalive: true });
    } else {
      acc.setVisible(true, nowMs());
    }
  };
  const onPageHide = () => {
    acc.setVisible(false, nowMs());
    void flushStudyTime({ keepalive: true });
  };
  let lastInputAt = 0;
  const onInput = () => {
    const t = nowMs();
    if (t - lastInputAt < 1000) return; // throttle pointermove / scroll bursts
    lastInputAt = t;
    acc.noteActivity(t);
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  for (const ev of INPUT_EVENTS) window.addEventListener(ev, onInput, { passive: true, capture: true });

  return () => {
    started = false;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput, { capture: true });
  };
}
