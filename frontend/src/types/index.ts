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
}

export interface VideoSession {
  video_id: string;
  title: string;
  author?: string;
  thumbnail_url?: string;
  duration: number;
  segments: Segment[];
}

export interface AnswerEvaluation {
  status: 'CORRECT' | 'MISCONCEPTION' | 'INCORRECT';
  is_correct: boolean;
  feedback: string;
  follow_up_prompt?: string | null;
}

export interface QAHistoryItem {
  segment_title: string;
  question: string;
  user_final_answer: string;
  ai_feedback: string;
  attempts: number;
}
