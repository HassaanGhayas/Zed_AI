from typing import List, Optional
from pydantic import BaseModel, Field

class TranscriptCue(BaseModel):
    start: float
    duration: float
    text: str

class Question(BaseModel):
    id: str
    prompt: str
    expected_concept: str
    hints: List[str] = Field(default_factory=list)

class Segment(BaseModel):
    segment_id: int
    title: str
    start_time: float
    end_time: float
    summary: str
    questions: List[Question] = Field(default_factory=list)

class VideoProcessRequest(BaseModel):
    url: str

class VideoProcessResponse(BaseModel):
    video_id: str
    title: str
    author: Optional[str] = ""
    thumbnail_url: Optional[str] = ""
    duration: float
    segments: List[Segment]

class MessageItem(BaseModel):
    role: str
    content: str

class AnswerEvaluationRequest(BaseModel):
    video_id: str
    segment_id: int
    question_id: str
    question_prompt: str
    expected_concept: str
    segment_summary: str
    segment_transcript: Optional[str] = ""
    user_answer: str
    attempt_count: int = 1
    chat_history: List[MessageItem] = Field(default_factory=list)

class AnswerEvaluationResponse(BaseModel):
    status: str  # "CORRECT", "MISCONCEPTION", "INCORRECT"
    is_correct: bool
    feedback: str
    follow_up_prompt: Optional[str] = None

class QAHistoryItem(BaseModel):
    segment_title: str
    question: str
    user_final_answer: str
    ai_feedback: str
    attempts: int = 1

class GenerateNotesRequest(BaseModel):
    video_title: str
    video_id: str
    segments: List[Segment]
    qa_history: List[QAHistoryItem]

class GenerateNotesResponse(BaseModel):
    markdown_notes: str

class DownloadPdfRequest(BaseModel):
    title: str
    markdown_content: str
