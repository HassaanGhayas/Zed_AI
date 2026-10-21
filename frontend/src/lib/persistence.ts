import type { VideoSession, QAHistoryItem, Segment, Question } from '../types';

/**
 * Best-effort localStorage persistence for the active study session so a page
 * refresh resumes the same video, chapter and mastery progress instead of
 * dumping the user back to the landing page.
 */
const STORAGE_KEY = 'mindflow-session-v1';

export interface PersistedSession {
  session: VideoSession;
  activeSegmentIndex: number;
  activeQuestionIndex: number;
  completedSegmentIds: number[];
  needsReviewSegmentIds?: number[];
  maxReachedIndex: number;
  qaHistory: QAHistoryItem[];
}

const MAX_QA_HISTORY = 500;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const clampInt = (v: unknown, min: number, max: number): number =>
  num(v) ? Math.min(max, Math.max(min, Math.floor(v))) : min;

function sanitizeSegment(raw: unknown): Segment | null {
  if (!isRecord(raw)) return null;
  const { segment_id, title, start_time, end_time, summary, questions } = raw;
  if (!num(segment_id) || typeof title !== 'string') return null;
  if (!num(start_time) || !num(end_time) || start_time < 0 || end_time <= start_time) return null;
  if (!Array.isArray(questions)) return null;
  const qs: Question[] = [];
  for (const q of questions) {
    if (!isRecord(q) || typeof q.id !== 'string' || typeof q.prompt !== 'string') return null;
    qs.push({
      id: q.id,
      prompt: q.prompt,
      expected_concept: typeof q.expected_concept === 'string' ? q.expected_concept : '',
      hints: strArray(q.hints),
    });
  }
  return {
    ...(raw as unknown as Segment),
    segment_id,
    title,
    start_time,
    end_time,
    summary: typeof summary === 'string' ? summary : '',
    questions: qs,
  };
}

function sanitizeQA(raw: unknown): QAHistoryItem | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.segment_title !== 'string' ||
    typeof raw.question !== 'string' ||
    typeof raw.user_final_answer !== 'string' ||
    typeof raw.ai_feedback !== 'string'
  ) {
    return null;
  }
  return {
    segment_title: raw.segment_title,
    question: raw.question,
    user_final_answer: raw.user_final_answer,
    ai_feedback: raw.ai_feedback,
    attempts: clampInt(raw.attempts, 1, 1000),
    ...(num(raw.score) ? { score: Math.min(100, Math.max(0, raw.score)) } : {}),
    ...(typeof raw.needs_review === 'boolean' ? { needs_review: raw.needs_review } : {}),
    understood_concepts: strArray(raw.understood_concepts),
    missing_concepts: strArray(raw.missing_concepts),
    misconceptions: strArray(raw.misconceptions),
    ...(num(raw.time_spent_ms) && raw.time_spent_ms >= 0 ? { time_spent_ms: Math.round(raw.time_spent_ms) } : {}),
  };
}

/**
 * Validates untrusted parsed JSON into a consistent PersistedSession, or null
 * if the core session is unusable. Exported for tests.
 */
export function validatePersistedSession(data: unknown): PersistedSession | null {
  if (!isRecord(data) || !isRecord(data.session)) return null;
  const s = data.session;
  if (typeof s.video_id !== 'string' || !s.video_id || typeof s.title !== 'string') return null;
  if (!Array.isArray(s.segments)) return null;

  const segments: Segment[] = [];
  for (const raw of s.segments) {
    const seg = sanitizeSegment(raw);
    if (!seg) return null; // a partially valid segment list would break the lock invariant
    segments.push(seg);
  }
  if (segments.length === 0) return null;
  const ids = new Set(segments.map((x) => x.segment_id));
  if (ids.size !== segments.length) return null;

  const knownIds = (v: unknown): number[] =>
    Array.isArray(v) ? Array.from(new Set(v.filter((x): x is number => num(x) && ids.has(x)))) : [];

  const last = segments.length - 1;
  const completedSegmentIds = knownIds(data.completedSegmentIds);
  // Chapters unlock sequentially, so reach can never pass the first unresolved chapter.
  let firstUnresolved = 0;
  while (firstUnresolved < last && completedSegmentIds.includes(segments[firstUnresolved].segment_id)) {
    firstUnresolved++;
  }
  const maxReachedIndex = Math.min(clampInt(data.maxReachedIndex, 0, last), firstUnresolved);
  const activeSegmentIndex = Math.min(clampInt(data.activeSegmentIndex, 0, last), maxReachedIndex);
  const activeSeg = segments[activeSegmentIndex];

  const qaHistory = (Array.isArray(data.qaHistory) ? data.qaHistory : [])
    .slice(0, MAX_QA_HISTORY)
    .map(sanitizeQA)
    .filter((x): x is QAHistoryItem => x !== null);

  return {
    session: {
      ...(s as unknown as VideoSession),
      video_id: s.video_id,
      title: s.title,
      duration: num(s.duration) ? Math.max(0, s.duration) : 0,
      segments,
    },
    activeSegmentIndex,
    activeQuestionIndex: clampInt(
      data.activeQuestionIndex,
      0,
      Math.max(0, (activeSeg?.questions.length ?? 1) - 1)
    ),
    completedSegmentIds,
    needsReviewSegmentIds: knownIds(data.needsReviewSegmentIds),
    maxReachedIndex,
    qaHistory,
  };
}

export function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validatePersistedSession(JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage: start fresh rather than crash.
    return null;
  }
}

export function savePersistedSession(value: PersistedSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota exceeded / private mode: persistence is best-effort, never fatal.
  }
}

export function clearPersistedSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
