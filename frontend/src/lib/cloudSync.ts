import type {
  AnalyticsRecordPayload,
  CloudAttemptRow,
  CloudSessionRow,
  QAHistoryItem,
  SessionHistoryEntry,
} from '../types';
import { supabase } from './supabase';
import { isForbiddenError, recordAnalytics } from './api';
import { loadPersistedSession, validatePersistedSession, type PersistedSession } from './persistence';
import { getSessionHistory, saveSessionToHistory } from './sessionHistory';

/**
 * Best-effort cloud sync on top of the localStorage layer. localStorage stays
 * the primary/offline store; every cloud call here is wrapped so a failure (or
 * Supabase being unset / the user signed out) is a silent no-op.
 */

const SYNC_DEBOUNCE_MS = 2000;
const MAX_ANSWER_CHARS = 5000;
const MIGRATED_KEY_PREFIX = 'studify-cloud-migrated-';

const OWNER_KEY = 'studify-local-owner';

let currentUserId: string | null = null;
let pending: { userId: string; value: PersistedSession; updatedAt: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set after "delete my cloud data" so nothing re-uploads until the next sign-in/out. */
let syncPaused = false;
/** True when the local data belongs to a different account than the signed-in one. */
let localDataForeign = false;
const foreignListeners = new Set<() => void>();

/** Analytics endpoints answered 403 (anonymous session): treated as "not available", no retries. */
let analyticsForbidden = false;

/** Every in-flight cloud write (upserts, inserts, /record, study-time flush) so delete can await them all. */
const inflightWrites = new Set<Promise<void>>();

/** Registers a cloud write; returns the same promise. Settled promises remove themselves. */
export function trackCloudWrite<T>(p: Promise<T>): Promise<T> {
  const t: Promise<void> = p
    .then(
      () => undefined,
      () => undefined
    )
    .then(() => {
      inflightWrites.delete(t);
    });
  inflightWrites.add(t);
  return p;
}

/** False once an analytics endpoint returned 403 for this user (anonymous session). */
export function isAnalyticsAvailable(): boolean {
  return !analyticsForbidden;
}

/** Called by callers that hit a 403 on an analytics endpoint. */
export function markAnalyticsForbidden(): void {
  analyticsForbidden = true;
}

export function cancelPendingSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = null;
}

// -- Local data ownership (shared devices) --

export function getLocalOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function setLocalOwner(userId: string): void {
  try {
    localStorage.setItem(OWNER_KEY, userId);
  } catch {
    // ignore
  }
}

/** True while the signed-in user differs from the account that owns this device's local data. */
export function isLocalDataForeign(): boolean {
  return localDataForeign;
}

/** Notified when a sign-in turns out to be a different account than the local data's owner. */
export function onLocalDataForeign(cb: () => void): () => void {
  foreignListeners.add(cb);
  return () => {
    foreignListeners.delete(cb);
  };
}

export function setCloudUser(userId: string | null): void {
  const changed = userId !== currentUserId;
  if (changed) {
    cancelPendingSync();
    syncPaused = false; // a pause lasts until the next sign-in or sign-out
    analyticsForbidden = false;
  }
  currentUserId = userId;
  const owner = getLocalOwner();
  localDataForeign = userId !== null && owner !== null && owner !== userId;
  if (changed && localDataForeign) foreignListeners.forEach((cb) => cb());
}

const canSync = (): boolean => Boolean(supabase && currentUserId && !syncPaused && !localDataForeign);

/** True when cloud/analytics writes are currently allowed (signed in, not paused, not foreign data). */
export function isSyncActive(): boolean {
  return canSync();
}

/** Stops all uploads (used by delete-cloud-data). Resumes on the next user change. */
export function pauseSync(): void {
  syncPaused = true;
  cancelPendingSync();
}

export function resumeSync(): void {
  syncPaused = false;
}

// ── Pure helpers (exported for tests) ──

const ts = (iso: string | undefined): number => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : 0;
};

export interface SyncStamp {
  id: string;
  updatedAt: string;
}

/**
 * Last-write-wins plan between local and cloud copies of the same sessions.
 * `upload`: local-only or strictly newer locally. `download`: cloud-only or
 * strictly newer in the cloud. Equal timestamps need no action.
 */
export function planSync(
  local: SyncStamp[],
  cloud: SyncStamp[]
): { upload: string[]; download: string[] } {
  const cloudById = new Map(cloud.map((c) => [c.id, c]));
  const localById = new Map(local.map((l) => [l.id, l]));
  const upload: string[] = [];
  const download: string[] = [];
  for (const l of local) {
    const c = cloudById.get(l.id);
    if (!c || ts(l.updatedAt) > ts(c.updatedAt)) upload.push(l.id);
  }
  for (const c of cloud) {
    const l = localById.get(c.id);
    if (!l || ts(c.updatedAt) > ts(l.updatedAt)) download.push(c.id);
  }
  return { upload, download };
}

/** Union of local and cloud history; for the same session the newest wins. */
export function mergeHistory(
  local: SessionHistoryEntry[],
  cloud: SessionHistoryEntry[]
): SessionHistoryEntry[] {
  const byId = new Map<string, SessionHistoryEntry>();
  for (const e of [...local, ...cloud]) {
    const prev = byId.get(e.sessionId);
    if (!prev || ts(e.lastUpdated) > ts(prev.lastUpdated)) byId.set(e.sessionId, e);
  }
  return Array.from(byId.values()).sort((a, b) => ts(b.lastUpdated) - ts(a.lastUpdated));
}

const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const count = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;

const rec = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Rebuilds a resumable (validated) PersistedSession from a cloud row, or null if unusable. */
export function rowToPersisted(row: CloudSessionRow): PersistedSession | null {
  return validatePersistedSession({ session: row.session, ...rec(row.progress) });
}

export function rowToHistoryEntry(row: CloudSessionRow): SessionHistoryEntry {
  const progress = rec(row.progress);
  const session = rec(row.session);
  const summary = rec(progress.summary); // present on migrated history-only stubs
  const qa = Array.isArray(progress.qaHistory) ? (progress.qaHistory as QAHistoryItem[]) : [];
  const totalTopics = Array.isArray(session.segments) && session.segments.length > 0
    ? session.segments.length
    : count(summary.totalTopics);
  const completed = Array.isArray(progress.completedSegmentIds) && progress.completedSegmentIds.length > 0
    ? progress.completedSegmentIds.length
    : count(summary.completedTopics);
  const review = Array.isArray(progress.needsReviewSegmentIds) && progress.needsReviewSegmentIds.length > 0
    ? progress.needsReviewSegmentIds.length
    : count(summary.needsReviewCount);
  const fromQa = (pick: (q: QAHistoryItem) => unknown, fallback: unknown) =>
    Array.from(new Set([...qa.flatMap((q) => strs(pick(q ?? ({} as QAHistoryItem)))), ...strs(fallback)]));
  return {
    sessionId: row.client_session_id,
    lectureTitle: row.lecture_title || 'Untitled Lecture',
    videoId: row.video_id,
    totalTopics,
    completedTopics: Math.min(completed, totalTopics),
    currentTopicIndex: count(progress.activeSegmentIndex),
    status: row.status === 'complete' ? 'complete' : 'active',
    needsReviewCount: review,
    understoodConcepts: fromQa((q) => q.understood_concepts, summary.understoodConcepts),
    missingConcepts: fromQa((q) => q.missing_concepts, summary.missingConcepts),
    misconceptions: fromQa((q) => q.misconceptions, summary.misconceptions),
    lastUpdated: row.updated_at,
  };
}

function progressOf(p: PersistedSession) {
  return {
    activeSegmentIndex: p.activeSegmentIndex,
    activeQuestionIndex: p.activeQuestionIndex,
    completedSegmentIds: p.completedSegmentIds,
    needsReviewSegmentIds: p.needsReviewSegmentIds ?? [],
    maxReachedIndex: p.maxReachedIndex,
    qaHistory: p.qaHistory,
  };
}

function statusOf(p: PersistedSession): 'active' | 'complete' {
  const total = p.session.segments.length;
  return total > 0 && p.completedSegmentIds.length >= total ? 'complete' : 'active';
}

export function buildSessionRow(userId: string, p: PersistedSession, updatedAt: string) {
  return {
    // Only sent when known so an older client never blanks a domain already in the cloud.
    ...(p.session.domain !== undefined ? { domain: p.session.domain } : {}),
    user_id: userId,
    client_session_id: p.session.video_id,
    video_id: p.session.video_id,
    lecture_title: p.session.title,
    session: p.session,
    progress: progressOf(p) as Record<string, unknown>,
    status: statusOf(p),
    updated_at: updatedAt,
  };
}

/** Same verdict vocabulary as the evaluator, derived from what the quiz records. */
export function deriveVerdict(item: QAHistoryItem): 'CORRECT' | 'MISCONCEPTION' | 'INCORRECT' {
  if (item.needs_review) return (item.misconceptions?.length ?? 0) > 0 ? 'MISCONCEPTION' : 'INCORRECT';
  return 'CORRECT';
}

export interface ReviewSummary {
  missingConcepts: { concept: string; count: number }[];
  misconceptions: { concept: string; count: number }[];
  needsReview: { segmentTitle: string; question: string; sessionId: string }[];
}

const tally = (lists: (string[] | null | undefined)[]) => {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const raw of list ?? []) {
      const c = typeof raw === 'string' ? raw.trim() : '';
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([concept, n]) => ({ concept, count: n })).sort(
    (a, b) => b.count - a.count || a.concept.localeCompare(b.concept)
  );
};

/** Aggregates attempts into what to revisit; repeated needs-review questions collapse to one. */
export function aggregateReview(rows: CloudAttemptRow[]): ReviewSummary {
  const seen = new Set<string>();
  const needsReview: ReviewSummary['needsReview'] = [];
  for (const r of rows) {
    if (!r.needs_review) continue;
    const key = `${r.client_session_id}|${r.question}`;
    if (seen.has(key)) continue;
    seen.add(key);
    needsReview.push({
      segmentTitle: r.segment_title,
      question: r.question,
      sessionId: r.client_session_id,
    });
  }
  return {
    missingConcepts: tally(rows.map((r) => r.missing_concepts)),
    misconceptions: tally(rows.map((r) => r.misconceptions)),
    needsReview,
  };
}

// ── Cloud calls (all best-effort) ──

interface PushJob {
  userId: string;
  value: PersistedSession;
  updatedAt: string;
  /** Insert-only: never overwrite an existing cloud row (history-only stubs). */
  ignoreDuplicates?: boolean;
  decorate?: (row: ReturnType<typeof buildSessionRow>) => void;
}

function doPush(job: PushJob): Promise<boolean> {
  return trackCloudWrite(doPushInner(job));
}

async function doPushInner(job: PushJob): Promise<boolean> {
  if (!supabase || syncPaused) return false;
  try {
    const row = buildSessionRow(job.userId, job.value, job.updatedAt);
    job.decorate?.(row);
    const { error } = await supabase
      .from('video_sessions')
      .upsert(row, {
        onConflict: 'user_id,client_session_id',
        ...(job.ignoreDuplicates ? { ignoreDuplicates: true } : {}),
      });
    return !error;
  } catch {
    return false;
  }
}

// One in-flight upsert per session key; later requests coalesce into one queued job.
const activePushes = new Map<string, Promise<boolean>>();
const queuedPushes = new Map<string, { job: PushJob; promise: Promise<boolean> }>();

function enqueuePush(job: PushJob): Promise<boolean> {
  const key = `${job.userId}|${job.value.session.video_id}`;
  const active = activePushes.get(key);
  if (!active) {
    const p: Promise<boolean> = doPush(job).finally(() => {
      if (activePushes.get(key) === p) activePushes.delete(key);
    });
    activePushes.set(key, p);
    return p;
  }
  const queued = queuedPushes.get(key);
  if (queued) {
    queued.job = job; // latest wins
    return queued.promise;
  }
  const entry = { job, promise: Promise.resolve(false) };
  entry.promise = active
    .catch(() => false)
    .then(() => {
      queuedPushes.delete(key);
      return enqueuePush(entry.job);
    });
  queuedPushes.set(key, entry);
  return entry.promise;
}

/**
 * Resolves once every in-flight cloud write has settled: session upserts (active
 * and queued), qa_attempts inserts, /record calls and study-time flushes.
 * Call after pauseSync(): writes started after the pause are refused.
 */
export async function settlePushes(): Promise<void> {
  while (activePushes.size > 0 || queuedPushes.size > 0 || inflightWrites.size > 0) {
    await Promise.allSettled([
      ...activePushes.values(),
      ...Array.from(queuedPushes.values(), (q) => q.promise),
      ...inflightWrites,
    ]);
  }
}

/** Debounced upsert of the active session; call from the existing local save point. */
export function scheduleSessionSync(value: PersistedSession): void {
  if (!canSync() || !currentUserId) return;
  setLocalOwner(currentUserId); // local data is now this account's
  pending = { userId: currentUserId, value, updatedAt: new Date().toISOString() };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void flushSessionSync();
  }, SYNC_DEBOUNCE_MS);
}

export async function flushSessionSync(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const job = pending;
  pending = null;
  if (!job || job.userId !== currentUserId || !canSync()) return;
  await enqueuePush(job);
}

function attemptRow(userId: string, clientSessionId: string, segmentId: number, item: QAHistoryItem) {
  return {
    user_id: userId,
    client_session_id: clientSessionId,
    segment_id: segmentId,
    segment_title: item.segment_title,
    question: item.question,
    answer: item.user_final_answer.slice(0, MAX_ANSWER_CHARS),
    feedback: item.ai_feedback,
    score: Math.round(item.score ?? (item.needs_review ? 40 : 85)),
    verdict: deriveVerdict(item),
    needs_review: Boolean(item.needs_review),
    understood_concepts: item.understood_concepts ?? [],
    missing_concepts: item.missing_concepts ?? [],
    misconceptions: item.misconceptions ?? [],
    attempts: item.attempts,
    time_spent_ms: cleanTimeMs(item.time_spent_ms),
  };
}

const MAX_TIME_SPENT_MS = 2 * 60 * 60 * 1000;

/** Integer ms in [0, 2h], or null when unknown/invalid. */
export function cleanTimeMs(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), MAX_TIME_SPENT_MS) : null;
}

const clampScore = (v: number): number => Math.min(100, Math.max(0, Math.round(v)));

/** Builds the analytics /record body for a video-checkpoint attempt (no answer text, no keys). */
export function buildVideoAnalyticsPayload(
  clientSessionId: string,
  segmentId: number,
  item: QAHistoryItem,
  domain: string | null,
  attemptId?: string,
  card?: { expected_concept?: string; hints?: string[] }
): AnalyticsRecordPayload {
  return {
    client_session_id: clientSessionId,
    video_id: clientSessionId,
    segment_id: segmentId,
    segment_title: item.segment_title,
    question: item.question,
    status: deriveVerdict(item),
    score: clampScore(item.score ?? (item.needs_review ? 40 : 85)),
    understood_concepts: item.understood_concepts ?? [],
    missing_concepts: item.missing_concepts ?? [],
    misconceptions: item.misconceptions ?? [],
    time_spent_ms: cleanTimeMs(item.time_spent_ms),
    source: 'video',
    domain,
    ...(attemptId ? { attempt_id: attemptId } : {}),
    ...(card?.expected_concept ? { expected_concept: card.expected_concept.slice(0, 500) } : {}),
    ...(card?.hints && card.hints.length > 0 ? { hints: card.hints.slice(0, 10) } : {}),
  };
}

/** Client-generated idempotency id for /record (crypto.randomUUID with a fallback). */
export function newAttemptId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const RECORD_RETRY_DELAY_MS = 500;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Best-effort analytics write: skipped when signed out / paused / foreign data; never throws. */
export function sendAnalyticsRecord(payload: AnalyticsRecordPayload): Promise<boolean> {
  if (!supabase || !canSync() || analyticsForbidden) return Promise.resolve(false);
  return trackCloudWrite(sendAnalyticsRecordInner(payload));
}

/**
 * One retry on a transient failure, re-sending the SAME payload (same attempt_id)
 * so the idempotent backend never double-counts. 403 = not available: no retry.
 */
async function sendAnalyticsRecordInner(payload: AnalyticsRecordPayload): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await recordAnalytics(payload);
      return true;
    } catch (err) {
      if (isForbiddenError(err)) {
        analyticsForbidden = true;
        return false;
      }
      if (attempt === 1) return false;
      await sleep(RECORD_RETRY_DELAY_MS);
      if (!canSync()) return false; // paused (delete) or signed out meanwhile: refuse the new write
    }
  }
  return false;
}

/**
 * Inserts the qa_attempts row, then (only if that succeeded) calls /record.
 * The backend tags the row with concept keys by matching
 * (user, client_session_id, question, segment_id), so the row must exist first.
 */
function insertThenRecord(
  clientSessionId: string,
  segmentId: number,
  item: QAHistoryItem,
  payload: AnalyticsRecordPayload
): Promise<void> {
  if (!supabase || !canSync() || !currentUserId) return Promise.resolve();
  return trackCloudWrite(insertThenRecordInner(clientSessionId, segmentId, item, payload));
}

async function insertThenRecordInner(
  clientSessionId: string,
  segmentId: number,
  item: QAHistoryItem,
  payload: AnalyticsRecordPayload
): Promise<void> {
  if (!supabase || !currentUserId) return;
  try {
    const res = await supabase.from('qa_attempts').insert(attemptRow(currentUserId, clientSessionId, segmentId, item));
    if (res?.error) return;
  } catch {
    return; // best-effort
  }
  if (canSync()) await sendAnalyticsRecord(payload);
}

/** Inserts one qa_attempts row for an evaluated answer, then records it for analytics. */
export async function recordQaAttempt(
  clientSessionId: string,
  segmentId: number,
  item: QAHistoryItem,
  domain: string | null = null,
  card?: { expected_concept?: string; hints?: string[] }
): Promise<void> {
  await insertThenRecord(
    clientSessionId,
    segmentId,
    item,
    buildVideoAnalyticsPayload(clientSessionId, segmentId, item, domain, newAttemptId(), card)
  );
}

/** Review-queue answer: same insert-then-record path, so /due can find the source question later. */
export async function recordReviewAttempt(
  item: QAHistoryItem,
  clientSessionId: string,
  payload: AnalyticsRecordPayload
): Promise<void> {
  await insertThenRecord(clientSessionId, payload.segment_id, item, payload);
}

/** Cloud rows, or null when signed out / unavailable / the request failed (never "empty" on error). */
export async function fetchCloudSessions(): Promise<CloudSessionRow[] | null> {
  if (!supabase || !currentUserId) return null;
  try {
    const { data, error } = await supabase
      .from('video_sessions')
      .select('client_session_id, video_id, lecture_title, session, progress, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error || !Array.isArray(data)) return null;
    return data as CloudSessionRow[];
  } catch {
    return null;
  }
}

/** Cloud sessions as history entries, for the history UI. Empty when signed out. */
export async function fetchCloudHistory(): Promise<SessionHistoryEntry[]> {
  return ((await fetchCloudSessions()) ?? []).map(rowToHistoryEntry);
}

/** Attempts that need review or exposed gaps, aggregated. Empty when signed out. */
export async function fetchReviewData(): Promise<ReviewSummary> {
  const empty: ReviewSummary = { missingConcepts: [], misconceptions: [], needsReview: [] };
  if (!supabase || !currentUserId) return empty;
  try {
    const { data, error } = await supabase
      .from('qa_attempts')
      .select('client_session_id, segment_id, segment_title, question, needs_review, missing_concepts, misconceptions, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error || !Array.isArray(data)) return empty;
    return aggregateReview(data as CloudAttemptRow[]);
  } catch {
    return empty;
  }
}

/**
 * On login: pull the latest cloud sessions into local history (last-write-wins
 * by updated_at) and, the first time this user signs in on this device, upload
 * local-only/newer sessions. Never overwrites the live in-memory session.
 */
export function syncOnLogin(userId: string): Promise<{ uploaded: number; downloaded: number }> {
  // getSession() and SIGNED_IN both fire on load: share one run per user.
  const running = inflight.get(userId);
  if (running) return running;
  const run = trackCloudWrite(runSyncOnLogin(userId)).finally(() => inflight.delete(userId));
  inflight.set(userId, run);
  return run;
}

const inflight = new Map<string, Promise<{ uploaded: number; downloaded: number }>>();

async function runSyncOnLogin(userId: string): Promise<{ uploaded: number; downloaded: number }> {
  const result = { uploaded: 0, downloaded: 0 };
  if (!supabase || currentUserId !== userId || !canSync()) return result;
  const stillValid = () => currentUserId === userId && canSync();
  try {
    const rows = await fetchCloudSessions();
    // A failed fetch is NOT "cloud is empty": abort with no uploads and no migration flag.
    if (rows === null || !stillValid()) return result;

    // First sign-in with unowned (anonymous) local data: claim it for this account.
    setLocalOwner(userId);

    const history = getSessionHistory();
    const plan = planSync(
      history.map((h) => ({ id: h.sessionId, updatedAt: h.lastUpdated })),
      rows.map((r) => ({ id: r.client_session_id, updatedAt: r.updated_at }))
    );

    for (const id of plan.download) {
      const row = rows.find((r) => r.client_session_id === id);
      if (!row) continue;
      saveSessionToHistory(rowToHistoryEntry(row));
      result.downloaded++;
    }

    let migrated = false;
    try {
      migrated = localStorage.getItem(MIGRATED_KEY_PREFIX + userId) === '1';
    } catch {
      // treat as not migrated
    }

    const persisted = loadPersistedSession();
    const cloudById = new Map(rows.map((r) => [r.client_session_id, r]));

    // Progress made before a debounce flush: re-push the active local session
    // when it is newer than (or missing from) the cloud copy.
    const ids = new Set<string>(migrated ? [] : plan.upload);
    if (persisted) {
      const activeId = persisted.session.video_id;
      const h = history.find((x) => x.sessionId === activeId);
      const c = cloudById.get(activeId);
      if (h && (!c || ts(h.lastUpdated) > ts(c.updated_at))) ids.add(activeId);
    }

    let allOk = true;
    for (const id of ids) {
      if (!stillValid()) return result;
      const h = history.find((x) => x.sessionId === id);
      if (!h) continue;
      const full = persisted && persisted.session.video_id === id ? persisted : null;
      const inCloud = cloudById.has(id);
      // History-only entries have no full session payload. Upload a summary
      // stub only when the cloud lacks the key, and insert-ignore so a row that
      // appeared meanwhile is never overwritten by a stub.
      if (!full && inCloud) continue;
      const value: PersistedSession = full ?? {
        session: { video_id: id, title: h.lectureTitle, duration: 0, segments: [] },
        activeSegmentIndex: h.currentTopicIndex,
        activeQuestionIndex: 0,
        completedSegmentIds: [],
        needsReviewSegmentIds: [],
        maxReachedIndex: 0,
        qaHistory: [],
      };
      const ok = await enqueuePush({
        userId,
        value,
        updatedAt: h.lastUpdated,
        ...(full
          ? {}
          : {
              ignoreDuplicates: true,
              decorate: (row: ReturnType<typeof buildSessionRow>) => {
                row.video_id = h.videoId || id;
                row.progress.summary = {
                  totalTopics: h.totalTopics,
                  completedTopics: h.completedTopics,
                  needsReviewCount: h.needsReviewCount,
                  understoodConcepts: h.understoodConcepts,
                  missingConcepts: h.missingConcepts,
                  misconceptions: h.misconceptions,
                };
                row.status = h.status;
              },
            }),
      });
      if (!ok) {
        allOk = false;
        continue;
      }
      result.uploaded++;
      // Backfill Q&A rows once, only for a session the cloud did not have yet.
      if (full && !inCloud) {
        const attempts = full.qaHistory.map((q) => {
          const seg = full.session.segments.find((s) => s.title === q.segment_title);
          return attemptRow(userId, id, seg?.segment_id ?? 0, q);
        });
        if (attempts.length > 0) {
          if (!stillValid()) return result;
          const { error } = await supabase.from('qa_attempts').insert(attempts);
          if (error) allOk = false;
        }
      }
    }
    // Only a fully successful migration is remembered; otherwise retry next sign-in.
    if (allOk && !migrated && stillValid()) {
      try {
        localStorage.setItem(MIGRATED_KEY_PREFIX + userId, '1');
      } catch {
        // ignore
      }
    }
  } catch {
    // best-effort; the migration flag is only set on the success path above
  }
  return result;
}

// ── Analytics settings (user_settings; RLS limits rows to the signed-in user) ──

/** Saved monthly study target in hours, or null when unset/unavailable. */
export async function fetchMonthlyTarget(): Promise<number | null> {
  if (!supabase || !currentUserId) return null;
  try {
    const { data, error } = await supabase
      .from('user_settings')
      .select('monthly_target_hours')
      .eq('user_id', currentUserId)
      .maybeSingle();
    if (error || !data) return null;
    const v = (data as { monthly_target_hours?: unknown }).monthly_target_hours;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Upserts the monthly target; false when signed out / paused / foreign / failed. */
export function saveMonthlyTarget(hours: number): Promise<boolean> {
  if (!supabase || !canSync() || !currentUserId) return Promise.resolve(false);
  return trackCloudWrite(saveMonthlyTargetInner(hours));
}

async function saveMonthlyTargetInner(hours: number): Promise<boolean> {
  if (!supabase || !currentUserId) return false;
  try {
    const { error } = await supabase
      .from('user_settings')
      .upsert({ user_id: currentUserId, monthly_target_hours: hours }, { onConflict: 'user_id' });
    return !error;
  } catch {
    return false;
  }
}
