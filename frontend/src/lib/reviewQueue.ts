import type { AnalyticsRecordPayload, AnswerEvaluation, DueItem, QAHistoryItem } from '../types';
import { evaluateAnswer } from './api';
import { cleanTimeMs, newAttemptId, recordReviewAttempt } from './cloudSync';

/** Pure state machine for walking the spaced-repetition review queue. */
export interface ReviewState {
  items: DueItem[];
  index: number;
  phase: 'answering' | 'feedback';
  result: AnswerEvaluation | null;
  reviewed: number;
  skipped: number;
}

export function initReview(items: DueItem[]): ReviewState {
  return { items, index: 0, phase: 'answering', result: null, reviewed: 0, skipped: 0 };
}

export const currentItem = (s: ReviewState): DueItem | null => s.items[s.index] ?? null;

export const isDone = (s: ReviewState): boolean => s.index >= s.items.length;

/** Records the graded result and moves to the feedback phase (item stays visible). */
export function showResult(s: ReviewState, result: AnswerEvaluation): ReviewState {
  if (isDone(s) || s.phase !== 'answering') return s;
  return { ...s, phase: 'feedback', result, reviewed: s.reviewed + 1 };
}

/** Moves on after feedback. */
export function advance(s: ReviewState): ReviewState {
  if (s.phase !== 'feedback') return s;
  return { ...s, index: s.index + 1, phase: 'answering', result: null };
}

/** Dismisses the current item without grading or recording anything (no penalty). */
export function skip(s: ReviewState): ReviewState {
  if (isDone(s) || s.phase !== 'answering') return s;
  return { ...s, index: s.index + 1, skipped: s.skipped + 1 };
}

/** Review re-asks the ORIGINAL question through the existing evaluator endpoint (single attempt). */
export function buildReviewEvalPayload(item: DueItem, answer: string) {
  return {
    video_id: item.video_id,
    segment_id: 0,
    question_id: item.concept_key.slice(0, 128),
    question_prompt: item.question,
    expected_concept: item.expected_concept,
    segment_summary: item.segment_title,
    user_answer: answer,
    attempt_count: 1,
  };
}

/** The item's real 1-indexed segment id; 0 when the backend did not send a usable one. */
export function reviewSegmentId(item: DueItem): number {
  const s = item.segment_id;
  return typeof s === 'number' && Number.isInteger(s) && s > 0 ? s : 0;
}

/** The /record body: structured grading only, never the answer text. */
export function buildReviewRecordPayload(
  item: DueItem,
  ev: AnswerEvaluation,
  timeSpentMs: number | null,
  attemptId: string = newAttemptId()
): AnalyticsRecordPayload {
  return {
    client_session_id: item.video_id,
    video_id: item.video_id,
    segment_id: reviewSegmentId(item),
    segment_title: item.segment_title,
    question: item.question,
    status: ev.status,
    score: Math.min(100, Math.max(0, Math.round(ev.score))),
    understood_concepts: ev.understood_concepts ?? [],
    missing_concepts: ev.missing_concepts ?? [],
    misconceptions: ev.misconceptions ?? [],
    time_spent_ms: cleanTimeMs(timeSpentMs),
    source: 'review',
    domain: item.domain,
    concept_key: item.concept_key,
    attempt_id: attemptId,
    ...(item.expected_concept ? { expected_concept: item.expected_concept.slice(0, 500) } : {}),
    ...(item.hints?.length ? { hints: item.hints.slice(0, 10) } : {}),
  };
}

/**
 * Grades a review answer with the existing evaluator, then records it for
 * scheduling (best-effort: a recording failure never loses the feedback).
 * Evaluator errors propagate so the UI can offer a retry.
 */
export async function submitReviewAnswer(
  item: DueItem,
  answer: string,
  timeSpentMs: number | null
): Promise<AnswerEvaluation> {
  const ev = await evaluateAnswer(buildReviewEvalPayload(item, answer));
  const payload = buildReviewRecordPayload(item, ev, timeSpentMs);
  const row: QAHistoryItem = {
    segment_title: item.segment_title,
    question: item.question,
    user_final_answer: answer,
    ai_feedback: ev.feedback,
    attempts: 1,
    score: payload.score,
    needs_review: ev.status !== 'CORRECT',
    understood_concepts: payload.understood_concepts,
    missing_concepts: payload.missing_concepts,
    misconceptions: payload.misconceptions,
    time_spent_ms: payload.time_spent_ms,
  };
  await recordReviewAttempt(row, item.video_id, payload);
  return ev;
}
