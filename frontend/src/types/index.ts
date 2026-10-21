export interface Question {
  id: string;
  prompt: string;
  expected_concept: string;
  hints: string[];
}

export interface Segment {
  segment_id: number;
  title: string;
  start_time: number;
  end_time: number;
  summary: string;
  questions: Question[];
  visual?: FrameVisual;
  keyframe_url?: string;
  keyframe_time?: number;
}

export interface EquationItem {
  latex: string;
  description: string;
}

export interface FrameVisual {
  has_visual_content: boolean;
  on_screen_text: string;
  equations: EquationItem[];
  diagram_description: string;
  key_concept: string;
  // Backend types this as Dict[str, str] (normally front/back keys)
  flashcard?: Record<string, string> | null;
}

export interface FrameExplanation {
  timestamp: number;
  frame_url: string;
  explanation: string;
  on_screen_text: string;
  equations: EquationItem[];
  diagram_description: string;
  key_concept: string;
}

export interface SegmentVisualResult {
  timestamp: number;
  frame_url: string;
  visual: FrameVisual;
}

export interface VideoSession {
  video_id: string;
  title: string;
  author?: string;
  thumbnail_url?: string;
  duration: number;
  segments: Segment[];
  /** Subject-area taxonomy label assigned by the backend (null/absent on older sessions). */
  domain?: string | null;
}

export interface AttemptHistoryItem {
  attempt_number: number;
  student_answer: string;
  verdict?: string;
  score?: number;
  feedback?: string;
  understood_concepts?: string[];
  missing_concepts?: string[];
  misconceptions?: string[];
}

export type AnswerStatus = 'CORRECT' | 'MISCONCEPTION' | 'INCORRECT';

export interface AnswerEvaluation {
  status: AnswerStatus;
  is_correct: boolean;
  score: number;
  feedback: string;
  understood_concepts: string[];
  missing_concepts: string[];
  misconceptions: string[];
  retry_question?: string | null;
  can_advance: boolean;
  needs_review: boolean;
  follow_up_prompt?: string | null;
}

export interface QAHistoryItem {
  segment_title: string;
  question: string;
  user_final_answer: string;
  ai_feedback: string;
  attempts: number;
  score?: number;
  needs_review?: boolean;
  understood_concepts?: string[];
  missing_concepts?: string[];
  misconceptions?: string[];
  /** Active time between the question appearing and its final graded answer. */
  time_spent_ms?: number | null;
}

export type TutorStage = 'SETUP' | 'WATCHING' | 'ACTIVE_RECALL' | 'REVIEW' | 'COMPLETE';

export interface SessionHistoryEntry {
  sessionId: string;
  lectureTitle: string;
  videoId: string;
  totalTopics: number;
  completedTopics: number;
  currentTopicIndex: number;
  status: 'active' | 'complete';
  needsReviewCount: number;
  understoodConcepts: string[];
  missingConcepts: string[];
  misconceptions: string[];
  lastUpdated: string;
}

/** A row of the optional Supabase `video_sessions` table (cloud sync). */
export interface CloudSessionRow {
  client_session_id: string;
  video_id: string;
  lecture_title: string;
  session: unknown;
  progress: unknown;
  status: 'active' | 'complete';
  updated_at: string;
}

/** A row of the optional Supabase `qa_attempts` table, as used by the Review view. */
export interface CloudAttemptRow {
  client_session_id: string;
  segment_id: number;
  segment_title: string;
  question: string;
  needs_review: boolean;
  missing_concepts: string[] | null;
  misconceptions: string[] | null;
  created_at: string;
}

// ── Analytics (backend /api/analytics/*; all require a signed-in user) ──

export interface AnalyticsRecordPayload {
  client_session_id: string;
  video_id: string;
  segment_id: number;
  segment_title: string;
  question: string;
  status: AnswerStatus;
  score: number;
  understood_concepts: string[];
  missing_concepts: string[];
  misconceptions: string[];
  time_spent_ms: number | null;
  source: 'video' | 'review';
  domain: string | null;
  /** Review attempts: the backend applies the result to this concept. */
  concept_key?: string;
  /** Client-generated uuid; makes /record idempotent (reuse the same id on retry). */
  attempt_id?: string;
  /** Lets /due rebuild the review card without a session lookup. */
  expected_concept?: string;
  hints?: string[];
}

export interface AnalyticsConceptUpdate {
  concept_key: string;
  label: string;
  strength: number;
  next_due: string;
}

export interface AnalyticsRecordResponse {
  concepts: AnalyticsConceptUpdate[];
  /** True when this attempt_id was already applied (nothing applied again). */
  replayed?: boolean;
}

export interface StudyTimeResponse {
  day: string;
  seconds: number;
}

export type DomainStatus = 'Mastered' | 'Advanced' | 'In Review' | 'Action Needed';

export interface AtRiskConcept {
  concept_key: string;
  label: string;
  domain: string | null;
  predicted_recall: number;
  next_due: string | null;
}

export interface AnalyticsSummary {
  period: { days: number; start: string; end: string };
  retention: { value: number | null; delta: number | null };
  velocity: {
    median_seconds_per_concept: number | null;
    delta_pct: number | null;
    fastest_domain: string | null;
  };
  consistency: { hours: number; target_hours: number; pct: number; delta_hours: number | null };
  decay: { at_risk_count: number; overdue_count: number; top_at_risk: AtRiskConcept[]; note?: string };
  curve: {
    days: number[];
    recall: number[];
    /** May be empty: then the baseline line is hidden. */
    natural: number[];
    reviews: { day: number; label: string }[];
    /** Model-projection explanation, shown under the chart. */
    note?: string;
    tracked?: number;
  };
  domains: { domain: string; mastery: number; concepts_tracked: number; status: DomainStatus; note: string }[];
  totals: { attempts: number; concepts: number };
}

export interface DueItem {
  concept_key: string;
  label: string;
  domain: string | null;
  question: string;
  expected_concept: string;
  hints: string[];
  segment_title: string;
  video_id: string;
  /** Original 1-indexed segment id (absent on older backends). */
  segment_id?: number;
  next_due: string | null;
  overdue_days: number;
}

export interface DueResponse {
  total_due: number;
  items: DueItem[];
}
