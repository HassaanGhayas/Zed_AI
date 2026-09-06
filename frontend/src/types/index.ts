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
  description?: string;
}

export interface FrameVisual {
  has_visual_content: boolean;
  on_screen_text?: string;
  equations?: EquationItem[];
  diagram_description?: string;
  key_concept?: string;
  flashcard?: { front: string; back: string } | null;
}

export interface FrameExplanation {
  timestamp: number;
  frame_url: string;
  explanation: string;
  on_screen_text?: string;
  equations?: EquationItem[];
  diagram_description?: string;
  key_concept?: string;
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

export interface AnswerEvaluation {
  status: 'CORRECT' | 'MISCONCEPTION' | 'INCORRECT';
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
