import type { VideoSession, QAHistoryItem } from '../types';

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
  maxReachedIndex: number;
  qaHistory: QAHistoryItem[];
}

export function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedSession;
    if (
      !data ||
      !data.session ||
      !Array.isArray(data.session.segments) ||
      data.session.segments.length === 0
    ) {
      return null;
    }
    return data;
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
