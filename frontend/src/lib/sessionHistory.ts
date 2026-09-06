import type { SessionHistoryEntry } from '../types';

/**
 * Client-side session history accumulator using localStorage.
 * Persists learning sessions created or completed by the student across videos.
 */
const STORAGE_KEY = 'mindflow_sessions_history_v1';

export function getSessionHistory(): SessionHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSessionToHistory(sessionData: Partial<SessionHistoryEntry> & { sessionId: string }): void {
  if (!sessionData || !sessionData.sessionId) return;
  try {
    const history = getSessionHistory();
    const existingIndex = history.findIndex((s) => s.sessionId === sessionData.sessionId);

    const updatedEntry: SessionHistoryEntry = {
      sessionId: sessionData.sessionId,
      lectureTitle: sessionData.lectureTitle || 'Untitled Lecture',
      videoId: sessionData.videoId || '',
      totalTopics: sessionData.totalTopics || 0,
      completedTopics: sessionData.completedTopics || 0,
      currentTopicIndex: sessionData.currentTopicIndex || 0,
      status: sessionData.status || 'active',
      needsReviewCount: sessionData.needsReviewCount || 0,
      understoodConcepts: Array.from(new Set(sessionData.understoodConcepts || [])),
      missingConcepts: Array.from(new Set(sessionData.missingConcepts || [])),
      misconceptions: Array.from(new Set(sessionData.misconceptions || [])),
      lastUpdated: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      const existing = history[existingIndex];
      history[existingIndex] = {
        ...existing,
        ...updatedEntry,
        understoodConcepts: Array.from(
          new Set([...(existing.understoodConcepts || []), ...(updatedEntry.understoodConcepts || [])])
        ),
        missingConcepts: Array.from(
          new Set([...(existing.missingConcepts || []), ...(updatedEntry.missingConcepts || [])])
        ),
        misconceptions: Array.from(
          new Set([...(existing.misconceptions || []), ...(updatedEntry.misconceptions || [])])
        ),
      };
    } else {
      history.unshift(updatedEntry);
    }

    // Keep up to 25 recent sessions
    const trimmed = history.slice(0, 25);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota or private mode: best-effort
  }
}

export function deleteSessionFromHistory(sessionId: string): void {
  try {
    const history = getSessionHistory().filter((s) => s.sessionId !== sessionId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // ignore
  }
}
