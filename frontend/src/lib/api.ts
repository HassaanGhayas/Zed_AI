import type {
  VideoSession,
  AnswerEvaluation,
  AttemptHistoryItem,
  QAHistoryItem,
  FrameExplanation,
  SegmentVisualResult,
} from '../types';

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
    attempt_history?: AttemptHistoryItem[];
    current_question_prompt?: string;
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

export async function transcribeAudio(blob: Blob, apiKey?: string): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': blob.type || 'audio/webm',
  };
  const key = apiKey || localStorage.getItem('gemini_api_key') || '';
  if (key) {
    headers['X-Gemini-Key'] = key;
  }

  const res = await fetch(`${API_BASE}/api/voice/transcribe`, {
    method: 'POST',
    headers,
    body: blob,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Transcription failed' }));
    throw new Error(err.detail || 'Transcription failed');
  }

  const data = await res.json();
  return data.text || '';
}

export async function downloadNotesPdf(
  title: string,
  markdownContent: string,
  opts?: { videoId?: string; keyframes?: { title: string; timestamp: number; caption?: string }[] }
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/notes/download-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      markdown_content: markdownContent,
      video_id: opts?.videoId || '',
      keyframes: opts?.keyframes || [],
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

// ── Visual analysis (Gemini vision over extracted video frames) ──

/** Absolute URL for a cached extracted frame at t seconds (used as an <img> src). */
export function frameUrl(videoId: string, tSeconds: number): string {
  const t = Math.max(0, tSeconds).toFixed(3);
  return `${API_BASE}/api/video/frame?video_id=${encodeURIComponent(videoId)}&t=${t}`;
}

export async function visualAvailability(
  apiKey?: string
): Promise<{ enabled: boolean; media_ready: boolean; config_enabled?: boolean }> {
  const res = await fetch(`${API_BASE}/api/video/visual/availability`, {
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
  const res = await fetch(`${API_BASE}/api/video/explain-frame`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Frame explanation failed' }));
    throw new Error(err.detail || 'Frame explanation failed');
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
  const res = await fetch(`${API_BASE}/api/video/segment-visual`, {
    method: 'POST',
    headers: getHeaders(apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Segment visual analysis failed' }));
    throw new Error(err.detail || 'Segment visual analysis failed');
  }

  return res.json();
}
