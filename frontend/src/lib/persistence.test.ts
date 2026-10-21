import { describe, expect, it } from 'vitest';
import { validatePersistedSession } from './persistence';

const seg = (id: number, start: number, end: number) => ({
  segment_id: id,
  title: `S${id}`,
  start_time: start,
  end_time: end,
  summary: 's',
  questions: [{ id: `q${id}`, prompt: 'p', expected_concept: 'c', hints: [] }],
});

const base = () => ({
  session: { video_id: 'abc', title: 'T', duration: 100, segments: [seg(1, 0, 30), seg(2, 30, 60)] },
  activeSegmentIndex: 0,
  activeQuestionIndex: 0,
  completedSegmentIds: [1],
  maxReachedIndex: 1,
  qaHistory: [],
});

describe('validatePersistedSession', () => {
  it('accepts valid data', () => {
    const out = validatePersistedSession(base());
    expect(out?.completedSegmentIds).toEqual([1]);
    expect(out?.needsReviewSegmentIds).toEqual([]);
  });

  it('rejects non-objects and empty/invalid segments', () => {
    expect(validatePersistedSession(null)).toBeNull();
    expect(validatePersistedSession('x')).toBeNull();
    const d = base();
    d.session.segments = [];
    expect(validatePersistedSession(d)).toBeNull();
    const bad = base();
    (bad.session.segments[0] as { end_time: unknown }).end_time = 'nope';
    expect(validatePersistedSession(bad)).toBeNull();
  });

  it('drops unknown completed ids and clamps indices', () => {
    const d = { ...base(), completedSegmentIds: [1, 99, 'x', NaN], activeSegmentIndex: 50, maxReachedIndex: -3 };
    const out = validatePersistedSession(d);
    expect(out?.completedSegmentIds).toEqual([1]);
    expect(out?.activeSegmentIndex).toBe(0);
    expect(out?.maxReachedIndex).toBe(0);
  });

  it('cannot reach past the first unresolved chapter (tampered progress)', () => {
    const tampered = { ...base(), completedSegmentIds: [], activeSegmentIndex: 1, maxReachedIndex: 9999 };
    const out = validatePersistedSession(tampered);
    expect(out?.maxReachedIndex).toBe(0);
    expect(out?.activeSegmentIndex).toBe(0);
    // non-contiguous completion (chapter 2 done, chapter 1 not) must not unlock chapter 2
    const gap = { ...base(), completedSegmentIds: [2], maxReachedIndex: 1, activeSegmentIndex: 1 };
    expect(validatePersistedSession(gap)?.maxReachedIndex).toBe(0);
  });

  it('keeps legitimate progress after a completed chapter', () => {
    const out = validatePersistedSession({ ...base(), activeSegmentIndex: 1, maxReachedIndex: 1 });
    expect(out?.maxReachedIndex).toBe(1);
    expect(out?.activeSegmentIndex).toBe(1);
  });

  it('filters malformed qaHistory entries and clamps score', () => {
    const d = {
      ...base(),
      qaHistory: [
        { segment_title: 'a', question: 'q', user_final_answer: 'x', ai_feedback: 'f', attempts: 2, score: 500 },
        { nope: true },
        null,
      ],
    };
    const out = validatePersistedSession(d);
    expect(out?.qaHistory).toHaveLength(1);
    expect(out?.qaHistory[0]?.score).toBe(100);
  });
});
