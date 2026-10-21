import { describe, expect, it } from 'vitest';
import { Stopwatch } from './stopwatch';

describe('Stopwatch', () => {
  it('is null until started, then excludes paused time', () => {
    const w = new Stopwatch();
    expect(w.elapsed(100)).toBeNull();
    w.restart(1000);
    expect(w.elapsed(4000)).toBe(3000);
    w.pause(4000);
    expect(w.elapsed(60_000)).toBe(3000);
    w.resume(60_000);
    expect(w.elapsed(62_000)).toBe(5000);
  });

  it('restart resets, and can start paused', () => {
    const w = new Stopwatch();
    w.restart(0);
    w.restart(5000, false);
    expect(w.elapsed(9000)).toBe(0);
    w.resume(9000);
    expect(w.elapsed(10_000)).toBe(1000);
  });
});
