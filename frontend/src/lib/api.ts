import type { VideoSession, AnswerEvaluation, QAHistoryItem } from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function getHeaders(customKey?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const key = customKey || localStorage.getItem('gemini_api_key') || '';
  if (key) {
    headers['X-Gemini-Key'] = key;
  }
  return headers;
}

export async function processVideo(url: string, apiKey?: string): Promise<VideoSession> {
  const res = await fetch(`${API_BASE}/api/video/process`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to process video' }));
    throw new Error(err.detail || 'Could not process video');
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
  },
  apiKey?: string
): Promise<AnswerEvaluation> {
  const res = await fetch(`${API_BASE}/api/qa/evaluate`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Evaluation failed' }));
    throw new Error(err.detail || 'Failed to evaluate answer');
  }

  return res.json();
}

export async function generateNotes(
  payload: {
    video_title: string;
    video_id: string;
    segments: any[];
    qa_history: QAHistoryItem[];
  },
  apiKey?: string
): Promise<string> {
  const res = await fetch(`${API_BASE}/api/notes/generate`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Failed to generate notes' }));
    throw new Error(err.detail || 'Failed to generate study notes');
  }

  const data = await res.json();
  return data.markdown_notes;
}

export async function downloadNotesPdf(title: string, markdownContent: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/notes/download-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      markdown_content: markdownContent,
    }),
  });

  if (!res.ok) {
    throw new Error('Failed to download PDF');
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
