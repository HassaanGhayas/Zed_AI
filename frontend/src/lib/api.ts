import type {
  VideoSession,
  AnswerEvaluation,
  AttemptHistoryItem,
  QAHistoryItem,
  FrameExplanation,
  SegmentVisualResult,
  Segment,
  AnalyticsRecordPayload,
  AnalyticsRecordResponse,
  AnalyticsSummary,
  DueResponse,
  InsightResponse,
  StudyTimeResponse,
} from '../types';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

if (import.meta.env.PROD && !import.meta.env.VITE_API_URL) {
  console.warn(
    '[Studify] VITE_API_URL is not set; falling back to http://localhost:8000. Set it at build time for deployed builds.'
  );
}

const DEFAULT_TIMEOUT_MS = 60_000;
const LONG_TIMEOUT_MS = 180_000;

const KEY_STORAGE = 'gemini_api_key';

/** Gemini key lives in sessionStorage; a legacy localStorage key is migrated once. */
export function getStoredGeminiKey(): string {
  try {
    const legacy = localStorage.getItem(KEY_STORAGE);
    if (legacy) {
      if (!sessionStorage.getItem(KEY_STORAGE)) sessionStorage.setItem(KEY_STORAGE, legacy);
      localStorage.removeItem(KEY_STORAGE);
    }
    return sessionStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setStoredGeminiKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // storage unavailable: key just won't persist for the session
  }
}

/** Supabase access token for the signed-in user (null when signed out / Supabase unset). */
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Returns a fresh access token (or null); registered by AuthContext. */
let tokenRefresher: (() => Promise<string | null>) | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function setTokenRefresher(fn: (() => Promise<string | null>) | null): void {
  tokenRefresher = fn;
}

/** Shared by concurrent 401s so one expired token triggers a single refresh. */
function refreshAuthToken(): Promise<string | null> {
  if (!tokenRefresher) return Promise.resolve(null);
  if (!refreshInFlight) {
    refreshInFlight = tokenRefresher()
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/**
 * Runs an authenticated request; if the server rejects the token (401, e.g. a
 * stale access token right after page load), refreshes it once and retries.
 */
async function requestWithAuthRetry(
  send: () => Promise<Response>
): Promise<Response> {
  const usedToken = authToken;
  const res = await send();
  if (res.status !== 401 || !authToken) return res;
  // A concurrent request already refreshed the token: just retry with it.
  if (authToken !== usedToken) return send();
  const fresh = await refreshAuthToken();
  if (!fresh) return res;
  setAuthToken(fresh);
  return send();
}

function getHeaders(customKey?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const key = customKey || getStoredGeminiKey();
  if (key) {
    headers['X-Gemini-Key'] = key;
  }
  return headers;
}

/** Turns a FastAPI error body (`detail` string, 422 array, or object) into readable text. */
export function formatErrorDetail(body: unknown, fallback: string): string {
  const detail = body && typeof body === 'object' ? (body as { detail?: unknown }).detail : undefined;
  const fmt = (d: unknown): string => {
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) {
      return d
        .map((item) => {
          if (item && typeof item === 'object') {
            const { loc, msg } = item as { loc?: unknown; msg?: unknown };
            const where = Array.isArray(loc)
              ? loc.filter((l) => l !== 'body').join('.')
              : '';
            if (typeof msg === 'string') return where ? `${where}: ${msg}` : msg;
          }
          return fmt(item);
        })
        .filter(Boolean)
        .join('; ');
    }
    if (d && typeof d === 'object') {
      const msg = (d as { message?: unknown; msg?: unknown }).message ?? (d as { msg?: unknown }).msg;
      if (typeof msg === 'string') return msg;
      try {
        return JSON.stringify(d);
      } catch {
        return '';
      }
    }
    return '';
  };
  return fmt(detail) || fallback;
}

/** fetch with an AbortController timeout and a clear timeout error. */
async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(
        `The request timed out after ${Math.round(timeoutMs / 1000)} seconds. Please try again.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Error carrying the HTTP status so callers can tell "not available" (403) from a real failure. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new ApiError(formatErrorDetail(body, fallback), res.status);
}

/** True for a 403 from the analytics endpoints (anonymous Supabase sessions): not an error, just unavailable. */
export function isForbiddenError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

export async function processVideo(url: string, apiKey?: string): Promise<VideoSession> {
  const res = await request(`${API_BASE}/api/video/process`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify({ url }),
  }, LONG_TIMEOUT_MS);

  if (!res.ok) {
    throw await errorFrom(res, 'Could not process video');
  }

  return res.json();
}

export async function evaluateAnswer(
  payload: {
    video_id: string;
    segment_id: number;
    question_id: string;
    question_prompt: string;
    expected_concept: string;
    segment_summary: string;
    segment_transcript?: string;
    user_answer: string;
    attempt_count: number;
    attempt_history?: AttemptHistoryItem[];
    current_question_prompt?: string;
  },
  apiKey?: string
): Promise<AnswerEvaluation> {
  const res = await request(`${API_BASE}/api/qa/evaluate`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await errorFrom(res, 'Failed to evaluate answer');
  }

  return res.json();
}

export async function generateNotes(
  payload: {
    video_title: string;
    video_id: string;
    segments: Segment[];
    qa_history: QAHistoryItem[];
  },
  apiKey?: string
): Promise<string> {
  const res = await request(`${API_BASE}/api/notes/generate`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify(payload),
  }, LONG_TIMEOUT_MS);

  if (!res.ok) {
    throw await errorFrom(res, 'Failed to generate study notes');
  }

  const data = await res.json();
  return data.markdown_notes;
}

export async function transcribeAudio(blob: Blob, apiKey?: string): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': blob.type || 'audio/webm',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const key = apiKey || getStoredGeminiKey();
  if (key) {
    headers['X-Gemini-Key'] = key;
  }

  const res = await request(`${API_BASE}/api/voice/transcribe`, {
    method: 'POST',
    headers,
    body: blob,
  });

  if (!res.ok) {
    throw await errorFrom(res, 'Transcription failed');
  }

  const data = await res.json();
  return data.text || '';
}

export async function downloadNotesPdf(
  title: string,
  markdownContent: string,
  opts?: { videoId?: string; keyframes?: { title: string; timestamp: number; caption?: string }[] }
): Promise<void> {
  const res = await request(`${API_BASE}/api/notes/download-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      markdown_content: markdownContent,
      video_id: opts?.videoId || '',
      keyframes: opts?.keyframes || [],
    }),
  }, LONG_TIMEOUT_MS);

  if (!res.ok) {
    throw await errorFrom(res, 'Failed to download PDF');
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const cleanTitle = title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  a.download = `${cleanTitle}_StudyNotes.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

/** Permanently deletes the signed-in user's cloud data (sessions + Q&A attempts). */
export async function deleteMyCloudData(): Promise<void> {
  if (!authToken) throw new Error('Sign in to manage your cloud data.');
  const res = await request(`${API_BASE}/api/me/data`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!res.ok) {
    throw await errorFrom(res, 'Failed to delete cloud data');
  }
}

// ── Visual analysis (Gemini vision over extracted video frames) ──

/** Absolute URL for a cached extracted frame at t seconds (used as an <img> src). */
export function frameUrl(videoId: string, tSeconds: number): string {
  const t = Math.max(0, tSeconds).toFixed(3);
  return `${API_BASE}/api/video/frame?video_id=${encodeURIComponent(videoId)}&t=${t}`;
}

export async function visualAvailability(
  apiKey?: string
): Promise<{ enabled: boolean; media_ready: boolean; config_enabled?: boolean }> {
  const res = await request(`${API_BASE}/api/video/visual/availability`, {
    headers: getHeaders(apiKey),
  });
  if (!res.ok) {
    throw new Error('Availability check failed');
  }
  return res.json();
}

export async function explainFrame(
  payload: {
    video_id: string;
    timestamp: number;
    question?: string;
    segment_title?: string;
    segment_summary?: string;
    transcript_excerpt?: string;
  },
  apiKey?: string
): Promise<FrameExplanation> {
  const res = await request(`${API_BASE}/api/video/explain-frame`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await errorFrom(res, 'Frame explanation failed');
  }

  return res.json();
}

export async function segmentVisual(
  payload: {
    video_id: string;
    start_time: number;
    end_time: number;
    title?: string;
    summary?: string;
  },
  apiKey?: string
): Promise<SegmentVisualResult> {
  const res = await request(`${API_BASE}/api/video/segment-visual`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw await errorFrom(res, 'Segment visual analysis failed');
  }

  return res.json();
}

// ── Analytics (signed-in only; bearer token, never the Gemini key except /insight) ──

/** Bearer-only headers: analytics calls must not carry the Gemini key (only /insight does). */
function authOnlyHeaders(): Record<string, string> {
  if (!authToken) throw new Error('Sign in to use analytics.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };
}

/** Records one graded attempt for spaced-repetition / analytics bookkeeping. */
export async function recordAnalytics(payload: AnalyticsRecordPayload): Promise<AnalyticsRecordResponse> {
  const res = await requestWithAuthRetry(() =>
    request(`${API_BASE}/api/analytics/record`, {
      method: 'POST',
      headers: authOnlyHeaders(),
      body: JSON.stringify(payload),
    })
  );
  if (!res.ok) throw await errorFrom(res, 'Could not record analytics');
  return res.json();
}

/** `keepalive` lets the request survive page unload (pagehide flush). */
export async function postStudyTime(
  seconds: number,
  day: string | null,
  opts?: { keepalive?: boolean }
): Promise<StudyTimeResponse> {
  const res = await requestWithAuthRetry(() =>
    request(`${API_BASE}/api/analytics/study-time`, {
      method: 'POST',
      headers: authOnlyHeaders(),
      body: JSON.stringify({ seconds, day }),
      ...(opts?.keepalive ? { keepalive: true } : {}),
    })
  );
  if (!res.ok) throw await errorFrom(res, 'Could not record study time');
  return res.json();
}

export async function fetchAnalyticsSummary(days: number): Promise<AnalyticsSummary> {
  const res = await requestWithAuthRetry(() =>
    request(`${API_BASE}/api/analytics/summary?days=${encodeURIComponent(String(days))}`, {
      headers: authOnlyHeaders(),
    })
  );
  if (!res.ok) throw await errorFrom(res, 'Could not load analytics');
  return res.json();
}

export async function fetchDueQueue(limit = 20): Promise<DueResponse> {
  const res = await requestWithAuthRetry(() =>
    request(`${API_BASE}/api/analytics/due?limit=${encodeURIComponent(String(limit))}`, {
      headers: authOnlyHeaders(),
    })
  );
  if (!res.ok) throw await errorFrom(res, 'Could not load your review queue');
  return res.json();
}

/** Asks the AI tutor for an insight; the only analytics call that forwards the Gemini key. */
export async function requestInsight(days: number, apiKey?: string): Promise<InsightResponse> {
  if (!authToken) throw new Error('Sign in to use analytics.');
  const res = await requestWithAuthRetry(() =>
    request(`${API_BASE}/api/analytics/insight`, {
      method: 'POST',
      headers: getHeaders(apiKey),
      body: JSON.stringify({ days }),
    }, LONG_TIMEOUT_MS)
  );
  if (!res.ok) throw await errorFrom(res, 'Could not generate an insight');
  return res.json();
}

export async function exportAnalytics(format: 'csv' | 'pdf', days: number): Promise<void> {
  const res = await requestWithAuthRetry(() =>
    request(
      `${API_BASE}/api/analytics/export?format=${format}&days=${encodeURIComponent(String(days))}`,
      { headers: authOnlyHeaders() },
      LONG_TIMEOUT_MS
    )
  );
  if (!res.ok) throw await errorFrom(res, `Could not export ${format.toUpperCase()}`);
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `studify-analytics-${days}d.${format}`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}
