import { describe, expect, it } from 'vitest';
import { evaluateBoundary, type BoundaryInput } from './playerBoundary';

const base: BoundaryInput = {
  time: 10,
  segmentEnd: 60,
  duration: 600,
  settled: true,
  isPausedForQuiz: false,
  isSegmentResolved: false,
};
const run = (o: Partial<BoundaryInput>) => evaluateBoundary({ ...base, ...o });

describe('evaluateBoundary', () => {
  it('does nothing before the boundary', () => {
    expect(run({ time: 30 })).toEqual({ effectiveEnd: 60, pause: false, seekTo: null, fireBoundary: false });
  });

  it('reaching segmentEnd while playing pauses and fires boundary', () => {
    expect(run({ time: 60 })).toEqual({ effectiveEnd: 60, pause: true, seekTo: null, fireBoundary: true });
  });

  it('not settled returns no actions', () => {
    const d = run({ time: 100, settled: false });
    expect(d).toEqual({ effectiveEnd: 60, pause: false, seekTo: null, fireBoundary: false });
  });

  it('non-finite time while unresolved pauses, never fires boundary', () => {
    const d = run({ time: NaN, isSegmentResolved: false });
    expect(d.pause).toBe(true);
    expect(d.fireBoundary).toBe(false);
    expect(d.seekTo).toBeNull();
  });

  it('non-finite time while resolved does nothing', () => {
    const d = run({ time: Infinity, isSegmentResolved: true });
    expect(d).toEqual({ effectiveEnd: 60, pause: false, seekTo: null, fireBoundary: false });
  });

  it('jump past end by more than 0.5 while unresolved seeks back to effectiveEnd and fires boundary', () => {
    const d = run({ time: 61, isSegmentResolved: false });
    expect(d).toEqual({ effectiveEnd: 60, pause: true, seekTo: 60, fireBoundary: true });
  });

  it('jump past end by exactly 0.5 does not seek back', () => {
    expect(run({ time: 60.5 }).seekTo).toBeNull();
  });

  it('jump past end while resolved does not seek back', () => {
    const d = run({ time: 80, isSegmentResolved: true });
    expect(d).toEqual({ effectiveEnd: 60, pause: true, seekTo: null, fireBoundary: true });
  });

  it('quiz open and time more than 0.5 past end seeks to effectiveEnd and pauses', () => {
    const d = run({ time: 75, isPausedForQuiz: true });
    expect(d).toEqual({ effectiveEnd: 60, pause: true, seekTo: 60, fireBoundary: false });
  });

  it('quiz open does not fire boundary again', () => {
    expect(run({ time: 60, isPausedForQuiz: true }).fireBoundary).toBe(false);
    expect(run({ time: 75, isPausedForQuiz: true }).fireBoundary).toBe(false);
  });

  it('quiz open and time within 0.5 past end does nothing', () => {
    const d = run({ time: 60.4, isPausedForQuiz: true });
    expect(d).toEqual({ effectiveEnd: 60, pause: false, seekTo: null, fireBoundary: false });
  });

  it('duration shorter than segmentEnd clamps effectiveEnd to duration - 0.5', () => {
    const d = run({ segmentEnd: 100, duration: 90, time: 89.5 });
    expect(d.effectiveEnd).toBe(89.5);
    expect(d.pause).toBe(true);
    expect(d.fireBoundary).toBe(true);
  });

  it('effectiveEnd never below 0', () => {
    expect(run({ duration: 0.2, segmentEnd: 5, time: 0 }).effectiveEnd).toBe(0);
  });

  it('missing duration uses segmentEnd', () => {
    expect(run({ duration: undefined }).effectiveEnd).toBe(60);
  });

  it('returns effectiveEnd while not settled', () => {
    expect(run({ settled: false, segmentEnd: 100, duration: 90 }).effectiveEnd).toBe(89.5);
  });
});
