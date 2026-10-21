import { beforeEach, describe, expect, it, vi } from 'vitest';

const evaluateMock = vi.hoisted(() => vi.fn());
const recordMock = vi.hoisted(() => vi.fn());
const inserts = vi.hoisted(() => [] as unknown[]);
vi.mock('./api', async () => ({
  ...(await vi.importActual<typeof import('./api')>('./api')),
  evaluateAnswer: evaluateMock,
  recordAnalytics: recordMock,
}));
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => {
        inserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
  isSupabaseEnabled: true,
}));

import {
  advance,
  buildReviewEvalPayload,
  currentItem,
  initReview,
  isDone,
  showResult,
  skip,
  submitReviewAnswer,
} from './reviewQueue';
import { setCloudUser, pauseSync } from './cloudSync';
import type { AnswerEvaluation, DueItem } from '../types';

const item = (n: number): DueItem => ({
  concept_key: `c${n}`,
  label: `Concept ${n}`,
  domain: 'Physics',
  question: `Original question ${n}?`,
  expected_concept: `expected ${n}`,
  hints: ['hint'],
  segment_title: 'Seg',
  video_id: 'vid1',
  next_due: '2026-06-01',
  overdue_days: n,
});

const evalResult = (over: Partial<AnswerEvaluation> = {}): AnswerEvaluation => ({
  status: 'CORRECT',
  is_correct: true,
  score: 88,
  feedback: 'good',
  understood_concepts: ['a'],
  missing_concepts: [],
  misconceptions: [],
  can_advance: true,
  needs_review: false,
  ...over,
});

beforeEach(() => {
  evaluateMock.mockReset();
  recordMock.mockReset();
  recordMock.mockResolvedValue({ concepts: [] });
  inserts.length = 0;
  setCloudUser(null);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});

describe('queue state machine', () => {
  it('walks answer -> feedback -> next and finishes', () => {
    let s = initReview([item(1), item(2)]);
    expect(currentItem(s)?.concept_key).toBe('c1');
    s = showResult(s, evalResult());
    expect(s.phase).toBe('feedback');
    expect(s.reviewed).toBe(1);
    s = advance(s);
    expect(currentItem(s)?.concept_key).toBe('c2');
    expect(s.phase).toBe('answering');
    s = advance(showResult(s, evalResult()));
    expect(isDone(s)).toBe(true);
    expect(s.reviewed).toBe(2);
  });

  it('skip advances without grading or counting as reviewed', () => {
    let s = initReview([item(1), item(2)]);
    s = skip(s);
    expect(s).toMatchObject({ index: 1, skipped: 1, reviewed: 0, phase: 'answering', result: null });
    expect(skip(skip(s)).index).toBe(2);
  });

  it('ignores out-of-phase actions and empty queues', () => {
    const s = initReview([item(1)]);
    expect(advance(s)).toBe(s);
    const fb = showResult(s, evalResult());
    expect(skip(fb)).toBe(fb);
    expect(showResult(fb, evalResult())).toBe(fb);
    expect(isDone(initReview([]))).toBe(true);
    expect(currentItem(initReview([]))).toBeNull();
  });
});

describe('submitReviewAnswer', () => {
  it('re-asks the original question via the evaluator, inserts a qa row, then records source=review', async () => {
    setCloudUser('u1');
    evaluateMock.mockResolvedValue(
      evalResult({ status: 'MISCONCEPTION', is_correct: false, score: 41, misconceptions: ['m'] })
    );
    const out = await submitReviewAnswer(item(3), 'my answer', 8_000);
    expect(out.score).toBe(41);

    const payload = evaluateMock.mock.calls[0][0];
    expect(payload).toMatchObject({
      question_prompt: 'Original question 3?',
      expected_concept: 'expected 3',
      user_answer: 'my answer',
      attempt_count: 1,
      video_id: 'vid1',
    });
    expect(payload).toEqual(buildReviewEvalPayload(item(3), 'my answer'));

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      client_session_id: 'vid1',
      segment_id: 0,
      question: 'Original question 3?',
      time_spent_ms: 8000,
    });

    const rec = recordMock.mock.calls[0][0];
    expect(rec).toMatchObject({
      source: 'review',
      client_session_id: 'vid1',
      segment_id: 0,
      status: 'MISCONCEPTION',
      score: 41,
      misconceptions: ['m'],
      time_spent_ms: 8000,
      domain: 'Physics',
      question: 'Original question 3?',
    });
    expect(JSON.stringify(rec)).not.toContain('my answer');
  });

  it('still returns feedback when signed out, paused, or the backend is down', async () => {
    evaluateMock.mockResolvedValue(evalResult());
    expect((await submitReviewAnswer(item(1), 'a', null)).status).toBe('CORRECT');
    expect(recordMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);

    setCloudUser('u1');
    pauseSync();
    await submitReviewAnswer(item(1), 'a', null);
    expect(recordMock).not.toHaveBeenCalled();

    setCloudUser('u2');
    recordMock.mockRejectedValue(new Error('down'));
    await expect(submitReviewAnswer(item(1), 'a', null)).resolves.toMatchObject({ status: 'CORRECT' });
  });

  it('propagates evaluator errors so the UI can retry, recording nothing', async () => {
    setCloudUser('u1');
    evaluateMock.mockRejectedValue(new Error('eval down'));
    await expect(submitReviewAnswer(item(1), 'a', 1)).rejects.toThrow('eval down');
    expect(recordMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});


describe('review attempts use the real segment id, concept key and attempt id', () => {
  it('sends segment_id / concept_key / attempt_id and inserts the same segment', async () => {
    setCloudUser('u1');
    evaluateMock.mockResolvedValue(evalResult());
    await submitReviewAnswer({ ...item(5), segment_id: 4 }, 'a', 1000);
    expect((inserts[0] as { segment_id: number }).segment_id).toBe(4);
    const rec = recordMock.mock.calls[0][0];
    expect(rec).toMatchObject({ segment_id: 4, concept_key: 'c5', source: 'review' });
    expect(typeof rec.attempt_id).toBe('string');
    expect(rec.attempt_id.length).toBeGreaterThan(8);
  });

  it('falls back to segment 0 when the item has none or an invalid one', async () => {
    setCloudUser('u1');
    evaluateMock.mockResolvedValue(evalResult());
    await submitReviewAnswer({ ...item(1), segment_id: -2 }, 'a', null);
    await submitReviewAnswer(item(1), 'a', null);
    expect(recordMock.mock.calls.map((c) => c[0].segment_id)).toEqual([0, 0]);
  });

  it('echoes expected_concept and hints', async () => {
    setCloudUser('u1');
    evaluateMock.mockResolvedValue(evalResult());
    await submitReviewAnswer(item(2), 'a', null);
    expect(recordMock.mock.calls[0][0]).toMatchObject({ expected_concept: 'expected 2', hints: ['hint'] });
  });

  it('generates a fresh attempt_id per submission', async () => {
    setCloudUser('u1');
    evaluateMock.mockResolvedValue(evalResult());
    await submitReviewAnswer(item(1), 'a', null);
    await submitReviewAnswer(item(1), 'a', null);
    const [x, y] = recordMock.mock.calls.map((c) => c[0].attempt_id);
    expect(x).not.toBe(y);
  });
});
