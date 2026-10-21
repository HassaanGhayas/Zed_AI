/** Elapsed-time counter that can be paused (e.g. while the tab is hidden). Pure: callers pass `now`. */
export class Stopwatch {
  private ms = 0;
  private startedAt: number | null = null;
  private started = false;

  /** Resets to zero and starts running (or paused if `running` is false). */
  restart(now: number, running = true): void {
    this.ms = 0;
    this.started = true;
    this.startedAt = running ? now : null;
  }

  pause(now: number): void {
    if (this.startedAt !== null) {
      this.ms += Math.max(0, now - this.startedAt);
      this.startedAt = null;
    }
  }

  resume(now: number): void {
    if (this.started && this.startedAt === null) this.startedAt = now;
  }

  /** Milliseconds elapsed, or null if never started. */
  elapsed(now: number): number | null {
    if (!this.started) return null;
    return this.ms + (this.startedAt !== null ? Math.max(0, now - this.startedAt) : 0);
  }
}
