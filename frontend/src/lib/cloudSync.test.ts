import { beforeEach, describe, expect, it, vi } from 'vitest';

const upserts: { table: string; row: unknown; opts?: { ignoreDuplicates?: boolean } }[] = [];
let selectError: unknown = null;
let upsertError: unknown = null;
let upsertGate: Promise<void> | null = null;
let activeUpserts = 0;
let maxConcurrentUpserts = 0;
const inserts: { table: string; row: unknown }[] = [];
const callOrder: string[] = [];
let cloudRows: unknown[] = [];

const recordAnalyticsMock = vi.hoisted(() => vi.fn());
const insertResult = vi.hoisted(() => ({ error: null as unknown }));
vi.mock('./api', async () => ({
  ...(await vi.importActual<typeof import('./api')>('./api')),
  recordAnalytics: recordAnalyticsMock,
}));
let insertGate: Promise<void> | null = null;

vi.mock('./supabase', () => {
  const client = {
    from: (table: string) => ({
      upsert: async (row: unknown, opts?: { ignoreDuplicates?: boolean }) => {
        upserts.push({ table, row, opts });
        activeUpserts++;
        maxConcurrentUpserts = Math.max(maxConcurrentUpserts, activeUpserts);
        if (upsertGate) await upsertGate;
        activeUpserts--;
        return { error: upsertError };
      },
      insert: (row: unknown) => {
        inserts.push({ table, row });
        callOrder.push('insert');
        return (async () => {
          if (insertGate) await insertGate;
          return { error: insertResult.error };
        })();
      },
      select: () => ({
        order: () => ({
          limit: () =>
            Promise.resolve({
              data: selectError ? null : table === 'video_sessions' ? cloudRows : [],
              error: selectError,
            }),
        }),
      }),
    }),
  };
  return { supabase: client, isSupabaseEnabled: true };
});

import { ApiError } from './api';
import {
  sendAnalyticsRecord,
  buildVideoAnalyticsPayload,
  newAttemptId,
  aggregateReview,
  cancelPendingSync,
  deriveVerdict,
  flushSessionSync,
  isLocalDataForeign,
  mergeHistory,
  onLocalDataForeign,
  pauseSync,
  settlePushes,
  planSync,
  recordQaAttempt,
  rowToHistoryEntry,
  scheduleSessionSync,
  setCloudUser,
  syncOnLogin,
} from './cloudSync';
import type { PersistedSession } from './persistence';
import type { CloudAttemptRow, CloudSessionRow, SessionHistoryEntry } from '../types';

const persisted = (): PersistedSession => ({
  session: {
    video_id: 'vid1',
    title: 'Lecture',
    duration: 100,
    segments: [
      { segment_id: 1, title: 'S1', start_time: 0, end_time: 30, summary: 's', questions: [] },
    ],
  } as PersistedSession['session'],
  activeSegmentIndex: 0,
  activeQuestionIndex: 0,
  completedSegmentIds: [],
  needsReviewSegmentIds: [],
  maxReachedIndex: 0,
  qaHistory: [],
});

const entry = (id: string, lastUpdated: string): SessionHistoryEntry => ({
  sessionId: id,
  lectureTitle: id,
  videoId: id,
  totalTopics: 2,
  completedTopics: 1,
  currentTopicIndex: 0,
  status: 'active',
  needsReviewCount: 0,
  understoodConcepts: [],
  missingConcepts: [],
  misconceptions: [],
  lastUpdated,
});

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

beforeEach(() => {
  upserts.length = 0;
  inserts.length = 0;
  cloudRows = [];
  selectError = null;
  upsertError = null;
  upsertGate = null;
  activeUpserts = 0;
  maxConcurrentUpserts = 0;
  recordAnalyticsMock.mockReset();
  recordAnalyticsMock.mockImplementation(async () => {
    callOrder.push('record');
    return { concepts: [] };
  });
  insertResult.error = null;
  callOrder.length = 0;
  setCloudUser(null);
  cancelPendingSync();
  vi.stubGlobal('localStorage', new MemStorage());
  vi.useRealTimers();
});

describe('planSync (last-write-wins)', () => {
  it('uploads local-only or newer, downloads cloud-only or newer, ignores ties', () => {
    const plan = planSync(
      [
        { id: 'a', updatedAt: '2026-01-02T00:00:00Z' }, // local newer
        { id: 'b', updatedAt: '2026-01-01T00:00:00Z' }, // cloud newer
        { id: 'c', updatedAt: '2026-01-01T00:00:00Z' }, // tie
        { id: 'd', updatedAt: '2026-01-01T00:00:00Z' }, // local only
      ],
      [
        { id: 'a', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'b', updatedAt: '2026-01-02T00:00:00Z' },
        { id: 'c', updatedAt: '2026-01-01T00:00:00Z' },
        { id: 'e', updatedAt: '2026-01-01T00:00:00Z' }, // cloud only
      ]
    );
    expect(plan.upload.sort()).toEqual(['a', 'd']);
    expect(plan.download.sort()).toEqual(['b', 'e']);
  });
});

describe('mergeHistory', () => {
  it('dedups by session id keeping the newest, sorted newest first', () => {
    const merged = mergeHistory(
      [entry('a', '2026-01-01T00:00:00Z'), entry('b', '2026-01-03T00:00:00Z')],
      [entry('a', '2026-01-02T00:00:00Z'), entry('c', '2026-01-01T12:00:00Z')]
    );
    expect(merged.map((e) => `${e.sessionId}@${e.lastUpdated}`)).toEqual([
      'b@2026-01-03T00:00:00Z',
      'a@2026-01-02T00:00:00Z',
      'c@2026-01-01T12:00:00Z',
    ]);
  });
});

describe('signed-out behaviour', () => {
  it('scheduling, recording, and syncing are no-ops without a user', async () => {
    vi.useFakeTimers();
    scheduleSessionSync(persisted());
    await vi.advanceTimersByTimeAsync(5000);
    await recordQaAttempt('vid1', 1, {
      segment_title: 'S1',
      question: 'q',
      user_final_answer: 'a',
      ai_feedback: 'f',
      attempts: 1,
    });
    expect(await syncOnLogin('u1')).toEqual({ uploaded: 0, downloaded: 0 });
    expect(upserts).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});

describe('debounced upsert', () => {
  it('coalesces rapid saves into one upsert after ~2s', async () => {
    vi.useFakeTimers();
    setCloudUser('u1');
    scheduleSessionSync(persisted());
    await vi.advanceTimersByTimeAsync(1000);
    scheduleSessionSync({ ...persisted(), completedSegmentIds: [1] });
    await vi.advanceTimersByTimeAsync(1999);
    expect(upserts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(upserts).toHaveLength(1);
    const row = upserts[0].row as { client_session_id: string; user_id: string; status: string };
    expect(upserts[0].table).toBe('video_sessions');
    expect(row.client_session_id).toBe('vid1');
    expect(row.user_id).toBe('u1');
    expect(row.status).toBe('complete');
  });

  it('flush pushes immediately and never includes a Gemini key', async () => {
    setCloudUser('u1');
    scheduleSessionSync(persisted());
    await flushSessionSync();
    expect(upserts).toHaveLength(1);
    expect(JSON.stringify(upserts[0].row)).not.toMatch(/gemini/i);
  });
});

describe('recordQaAttempt', () => {
  it('truncates answers to 5000 chars and derives a verdict', async () => {
    setCloudUser('u1');
    await recordQaAttempt('vid1', 1, {
      segment_title: 'S1',
      question: 'q',
      user_final_answer: 'x'.repeat(6000),
      ai_feedback: 'f',
      attempts: 2,
      needs_review: true,
      misconceptions: ['m'],
    });
    const row = inserts[0].row as { answer: string; verdict: string; segment_id: number };
    expect(row.answer).toHaveLength(5000);
    expect(row.verdict).toBe('MISCONCEPTION');
    expect(row.segment_id).toBe(1);
    expect(
      deriveVerdict({ segment_title: '', question: '', user_final_answer: '', ai_feedback: '', attempts: 1 })
    ).toBe('CORRECT');
  });
});

describe('recordQaAttempt analytics', () => {
  const item = {
    segment_title: 'S1',
    question: 'What is X?',
    user_final_answer: 'my secret answer',
    ai_feedback: 'f',
    attempts: 1,
    score: 91.6,
    understood_concepts: ['a'],
    time_spent_ms: 12_345.4,
  };

  it('inserts first, then posts /record without the answer text', async () => {
    setCloudUser('u1');
    await recordQaAttempt('vid1', 2, item, 'Physics');
    expect(callOrder).toEqual(['insert', 'record']);
    expect((inserts[0].row as { time_spent_ms: number }).time_spent_ms).toBe(12345);
    const body = recordAnalyticsMock.mock.calls[0][0];
    expect(body).toMatchObject({
      client_session_id: 'vid1',
      video_id: 'vid1',
      segment_id: 2,
      question: 'What is X?',
      status: 'CORRECT',
      score: 92,
      time_spent_ms: 12345,
      source: 'video',
      domain: 'Physics',
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('skips /record when the insert fails', async () => {
    setCloudUser('u1');
    insertResult.error = { message: 'rls' };
    await recordQaAttempt('vid1', 1, item);
    expect(recordAnalyticsMock).not.toHaveBeenCalled();
  });

  it('sends null time and domain when unknown', async () => {
    setCloudUser('u1');
    await recordQaAttempt('vid1', 1, { ...item, time_spent_ms: undefined });
    expect(recordAnalyticsMock.mock.calls[0][0]).toMatchObject({ time_spent_ms: null, domain: null });
  });

  it('is skipped when signed out', async () => {
    await recordQaAttempt('vid1', 1, item);
    expect(recordAnalyticsMock).not.toHaveBeenCalled();
  });

  it('is skipped while sync is paused (after delete)', async () => {
    setCloudUser('u1');
    pauseSync();
    await recordQaAttempt('vid1', 1, item);
    expect(recordAnalyticsMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("is skipped for another account's local data", async () => {
    localStorage.setItem('studify-local-owner', 'someone-else');
    setCloudUser('u1');
    await recordQaAttempt('vid1', 1, item);
    expect(recordAnalyticsMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('never throws when the backend call fails', async () => {
    setCloudUser('u1');
    recordAnalyticsMock.mockRejectedValue(new Error('boom'));
    await expect(recordQaAttempt('vid1', 1, item)).resolves.toBeUndefined();
  });
});

describe('syncOnLogin', () => {
  const cloudRow = (id: string, updated_at: string): CloudSessionRow => ({
    client_session_id: id,
    video_id: id,
    lecture_title: `Cloud ${id}`,
    session: { video_id: id, title: `Cloud ${id}`, segments: [{ segment_id: 1 }] },
    progress: { completedSegmentIds: [1], needsReviewSegmentIds: [], activeSegmentIndex: 0, qaHistory: [] },
    status: 'active',
    updated_at,
  });

  it('downloads cloud-only sessions into local history and migrates local-only ones once', async () => {
    localStorage.setItem(
      'mindflow_sessions_history_v1',
      JSON.stringify([entry('local1', '2026-01-01T00:00:00.000Z')])
    );
    cloudRows = [cloudRow('cloud1', '2026-02-01T00:00:00.000Z')];
    setCloudUser('u1');

    const first = await syncOnLogin('u1');
    expect(first).toEqual({ uploaded: 1, downloaded: 1 });
    expect((upserts[0].row as { client_session_id: string }).client_session_id).toBe('local1');
    const stored = JSON.parse(localStorage.getItem('mindflow_sessions_history_v1')!);
    expect(stored.map((e: SessionHistoryEntry) => e.sessionId).sort()).toEqual(['cloud1', 'local1']);
    expect(stored.find((e: SessionHistoryEntry) => e.sessionId === 'cloud1').lastUpdated).toBe(
      '2026-02-01T00:00:00.000Z'
    );

    upserts.length = 0;
    const second = await syncOnLogin('u1');
    expect(second.uploaded).toBe(0);
    expect(upserts).toHaveLength(0);
  });

  it('does not overwrite a newer local copy with an older cloud one', async () => {
    localStorage.setItem(
      'mindflow_sessions_history_v1',
      JSON.stringify([entry('s1', '2026-03-01T00:00:00.000Z')])
    );
    cloudRows = [cloudRow('s1', '2026-02-01T00:00:00.000Z')];
    setCloudUser('u1');
    const res = await syncOnLogin('u1');
    expect(res.downloaded).toBe(0);
    // History-only (stub) data never overwrites an existing cloud row.
    expect(res.uploaded).toBe(0);
    expect(upserts).toHaveLength(0);
  });
});

const cloudRowFor = (id: string, updated_at: string) => ({
  client_session_id: id,
  video_id: id,
  lecture_title: 'c',
  session: {},
  progress: {},
  status: 'active',
  updated_at,
});

describe('syncOnLogin hardening', () => {
  const HIST = 'mindflow_sessions_history_v1';
  const MIG = 'studify-cloud-migrated-u1';

  it('aborts on a cloud fetch error: no uploads, no migration flag', async () => {
    localStorage.setItem(HIST, JSON.stringify([entry('local1', '2026-01-01T00:00:00.000Z')]));
    selectError = { message: 'boom' };
    setCloudUser('u1');
    const res = await syncOnLogin('u1');
    expect(res).toEqual({ uploaded: 0, downloaded: 0 });
    expect(upserts).toHaveLength(0);
    expect(localStorage.getItem(MIG)).toBeNull();
  });

  it('uploads history-only stubs insert-ignore, and skips keys already in the cloud', async () => {
    localStorage.setItem(
      HIST,
      JSON.stringify([
        entry('stub1', '2026-03-01T00:00:00.000Z'),
        entry('inCloud', '2026-03-01T00:00:00.000Z'),
      ])
    );
    cloudRows = [cloudRowFor('inCloud', '2026-01-01T00:00:00.000Z')];
    setCloudUser('u1');
    await syncOnLogin('u1');
    expect(upserts).toHaveLength(1);
    expect((upserts[0].row as { client_session_id: string }).client_session_id).toBe('stub1');
    expect(upserts[0].opts?.ignoreDuplicates).toBe(true);
  });

  it('sets the migration flag only when every upload succeeded', async () => {
    localStorage.setItem(HIST, JSON.stringify([entry('local1', '2026-01-01T00:00:00.000Z')]));
    upsertError = { message: 'rls' };
    setCloudUser('u1');
    await syncOnLogin('u1');
    expect(upserts).toHaveLength(1);
    expect(localStorage.getItem(MIG)).toBeNull();

    upsertError = null;
    await syncOnLogin('u1');
    expect(localStorage.getItem(MIG)).toBe('1');
  });

  it('re-pushes the active local session when newer than the cloud copy, even after migration', async () => {
    localStorage.setItem(MIG, '1');
    localStorage.setItem('mindflow-session-v1', JSON.stringify(persisted()));
    localStorage.setItem(HIST, JSON.stringify([entry('vid1', '2026-03-01T00:00:00.000Z')]));
    cloudRows = [cloudRowFor('vid1', '2026-01-01T00:00:00.000Z')];
    setCloudUser('u1');
    await syncOnLogin('u1');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].opts?.ignoreDuplicates).toBeUndefined();
  });
});

describe('shared device ownership', () => {
  it('does not migrate or upload local data owned by another account, and notifies', async () => {
    localStorage.setItem('studify-local-owner', 'userA');
    localStorage.setItem(
      'mindflow_sessions_history_v1',
      JSON.stringify([entry('local1', '2026-01-01T00:00:00.000Z')])
    );
    const cb = vi.fn();
    const off = onLocalDataForeign(cb);
    setCloudUser('userB');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(isLocalDataForeign()).toBe(true);
    expect(await syncOnLogin('userB')).toEqual({ uploaded: 0, downloaded: 0 });
    scheduleSessionSync(persisted());
    await flushSessionSync();
    expect(upserts).toHaveLength(0);
    expect(localStorage.getItem('studify-cloud-migrated-userB')).toBeNull();
    expect(localStorage.getItem('studify-local-owner')).toBe('userA');
    off();
  });

  it('tags unowned local data with the signed-in user on save', async () => {
    setCloudUser('u1');
    scheduleSessionSync(persisted());
    expect(localStorage.getItem('studify-local-owner')).toBe('u1');
    await flushSessionSync();
    expect(upserts).toHaveLength(1);
  });
});

describe('pause after delete', () => {
  it('blocks pushes until the user changes (token refresh does not resume)', async () => {
    setCloudUser('u1');
    pauseSync();
    scheduleSessionSync(persisted());
    await flushSessionSync();
    expect(upserts).toHaveLength(0);
    setCloudUser('u1');
    scheduleSessionSync(persisted());
    await flushSessionSync();
    expect(upserts).toHaveLength(0);
    setCloudUser(null);
    setCloudUser('u1');
    scheduleSessionSync(persisted());
    await flushSessionSync();
    expect(upserts).toHaveLength(1);
  });

  it('settlePushes waits for an in-flight push', async () => {
    let release!: () => void;
    upsertGate = new Promise<void>((r) => (release = r));
    setCloudUser('u1');
    scheduleSessionSync(persisted());
    const flushing = flushSessionSync();
    let settled = false;
    const settling = settlePushes().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await Promise.all([flushing, settling]);
    expect(settled).toBe(true);
  });
});

describe('push serialisation', () => {
  it('never runs two upserts for one session at once and coalesces to the latest', async () => {
    let release!: () => void;
    upsertGate = new Promise<void>((r) => (release = r));
    setCloudUser('u1');
    scheduleSessionSync(persisted());
    const f1 = flushSessionSync();
    scheduleSessionSync(persisted());
    const f2 = flushSessionSync();
    scheduleSessionSync({ ...persisted(), completedSegmentIds: [1] });
    const f3 = flushSessionSync();
    release();
    await Promise.all([f1, f2, f3]);
    expect(maxConcurrentUpserts).toBe(1);
    expect(upserts).toHaveLength(2);
    expect((upserts[1].row as { status: string }).status).toBe('complete');
  });
});

describe('review aggregation and history rows', () => {
  it('counts concepts and dedups needs-review questions', () => {
    const base = { segment_id: 1, segment_title: 'S1', created_at: '', client_session_id: 'v' };
    const rows: CloudAttemptRow[] = [
      { ...base, question: 'q1', needs_review: true, missing_concepts: ['A', 'B'], misconceptions: ['M'] },
      { ...base, question: 'q1', needs_review: true, missing_concepts: ['A'], misconceptions: null },
      { ...base, question: 'q2', needs_review: false, missing_concepts: null, misconceptions: ['M'] },
    ];
    const out = aggregateReview(rows);
    expect(out.missingConcepts).toEqual([
      { concept: 'A', count: 2 },
      { concept: 'B', count: 1 },
    ]);
    expect(out.misconceptions).toEqual([{ concept: 'M', count: 2 }]);
    expect(out.needsReview).toHaveLength(1);
  });

  it('builds a history entry from a cloud row', () => {
    const e = rowToHistoryEntry({
      client_session_id: 'x',
      video_id: 'x',
      lecture_title: 'T',
      session: { segments: [{}, {}, {}] },
      progress: { completedSegmentIds: [1, 2], needsReviewSegmentIds: [2], activeSegmentIndex: 1, qaHistory: [] },
      status: 'active',
      updated_at: '2026-01-01T00:00:00Z',
    });
    expect(e).toMatchObject({ totalTopics: 3, completedTopics: 2, needsReviewCount: 1, currentTopicIndex: 1 });
  });
});


describe('delete race: all cloud writes are tracked and awaited', () => {
  const item = {
    segment_title: 'S1',
    question: 'Q?',
    user_final_answer: 'a',
    ai_feedback: 'f',
    attempts: 1,
    score: 80,
  };
  const payload = () => buildVideoAnalyticsPayload('vid1', 1, item, null, newAttemptId());

  beforeEach(() => {
    insertGate = null;
    recordAnalyticsMock.mockReset();
    recordAnalyticsMock.mockResolvedValue({ concepts: [] });
    setCloudUser(null);
  });

  it('settlePushes waits for an in-flight qa_attempts insert and then refuses the follow-up /record', async () => {
    let release!: () => void;
    insertGate = new Promise<void>((r) => (release = r));
    setCloudUser('u1');
    const writing = recordQaAttempt('vid1', 1, item);
    pauseSync();
    let settled = false;
    const settling = settlePushes().then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    release();
    await Promise.all([writing, settling]);
    expect(settled).toBe(true);
    expect(recordAnalyticsMock).not.toHaveBeenCalled(); // started after pause: refused
  });

  it('settlePushes waits for an in-flight /record call', async () => {
    let release!: () => void;
    recordAnalyticsMock.mockImplementation(() => new Promise<void>((r) => (release = r)));
    setCloudUser('u1');
    const sending = sendAnalyticsRecord(payload());
    pauseSync();
    let settled = false;
    const settling = settlePushes().then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(settled).toBe(false);
    release();
    await Promise.all([sending, settling]);
    expect(settled).toBe(true);
  });

  it('refuses every new write after pauseSync', async () => {
    setCloudUser('u1');
    pauseSync();
    expect(await sendAnalyticsRecord(payload())).toBe(false);
    await recordQaAttempt('vid1', 1, item);
    scheduleSessionSync(persisted());
    await flushSessionSync();
    expect(recordAnalyticsMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
    expect(upserts).toHaveLength(0);
  });
});

describe('/record idempotency and 403 handling', () => {
  const item = {
    segment_title: 'S1',
    question: 'Q?',
    user_final_answer: 'a',
    ai_feedback: 'f',
    attempts: 1,
    score: 80,
  };

  beforeEach(() => {
    insertGate = null;
    recordAnalyticsMock.mockReset();
    setCloudUser(null);
  });

  it('video attempts carry an attempt_id and a retry re-sends the SAME id', async () => {
    vi.useFakeTimers();
    try {
      recordAnalyticsMock.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ concepts: [] });
      setCloudUser('u1');
      const p = recordQaAttempt('vid1', 1, item);
      await vi.advanceTimersByTimeAsync(2000);
      await p;
      expect(recordAnalyticsMock).toHaveBeenCalledTimes(2);
      const [a, b] = recordAnalyticsMock.mock.calls.map((c) => c[0].attempt_id);
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(8);
      expect(a).toBe(b);
      expect(inserts).toHaveLength(1); // the qa_attempts row is not re-inserted on retry
    } finally {
      vi.useRealTimers();
    }
  });

  it('video attempts send expected_concept and hints', async () => {
    recordAnalyticsMock.mockResolvedValue({ concepts: [], replayed: false });
    setCloudUser('u1');
    await recordQaAttempt('vid1', 1, item, null, { expected_concept: 'entropy', hints: ['h1'] });
    expect(recordAnalyticsMock.mock.calls[0][0]).toMatchObject({ expected_concept: 'entropy', hints: ['h1'] });
  });

  it('different attempts get different ids', () => {
    expect(newAttemptId()).not.toBe(newAttemptId());
  });

  it('treats 403 as not available: no retry, later calls are skipped silently', async () => {
    recordAnalyticsMock.mockRejectedValue(new ApiError('forbidden', 403));
    setCloudUser('u1');
    await expect(recordQaAttempt('vid1', 1, item)).resolves.toBeUndefined();
    expect(recordAnalyticsMock).toHaveBeenCalledTimes(1);
    await recordQaAttempt('vid1', 2, item);
    expect(recordAnalyticsMock).toHaveBeenCalledTimes(1);
  });
});
