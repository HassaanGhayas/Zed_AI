from typing import Dict, List, Optional
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

class EquationItem(BaseModel):
    latex: str
    description: str = ""

class FrameAnalysis(BaseModel):
    has_visual_content: bool = False
    on_screen_text: str = ""
    equations: List[EquationItem] = Field(default_factory=list)
    diagram_description: str = ""
    key_concept: str = ""
    flashcard: Optional[Dict[str, str]] = None

class Segment(BaseModel):
    segment_id: int
    title: str
    start_time: float
    end_time: float
    summary: str
    questions: List[Question] = Field(default_factory=list)
    # Optional visual enrichment (populated only when visual analysis is requested)
    visual: Optional[FrameAnalysis] = None
    keyframe_url: Optional[str] = None
    keyframe_time: Optional[float] = None

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

class AttemptHistoryItem(BaseModel):
    attempt_number: int = 1
    student_answer: str = ""
    verdict: Optional[str] = ""
    score: Optional[int] = 0
    feedback: Optional[str] = ""
    understood_concepts: List[str] = Field(default_factory=list)
    missing_concepts: List[str] = Field(default_factory=list)
    misconceptions: List[str] = Field(default_factory=list)

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
    attempt_history: List[AttemptHistoryItem] = Field(default_factory=list)
    current_question_prompt: Optional[str] = None

class AnswerEvaluationResponse(BaseModel):
    status: str  # "CORRECT", "MISCONCEPTION", "INCORRECT"
    is_correct: bool
    score: int = 0  # 0-100 mastery score
    feedback: str
    understood_concepts: List[str] = Field(default_factory=list)
    missing_concepts: List[str] = Field(default_factory=list)
    misconceptions: List[str] = Field(default_factory=list)
    retry_question: Optional[str] = None
    can_advance: bool = False
    needs_review: bool = False
    follow_up_prompt: Optional[str] = None

class QAHistoryItem(BaseModel):
    segment_title: str
    question: str
    user_final_answer: str
    ai_feedback: str
    attempts: int = 1
    score: int = 0
    needs_review: bool = False
    understood_concepts: List[str] = Field(default_factory=list)
    missing_concepts: List[str] = Field(default_factory=list)
    misconceptions: List[str] = Field(default_factory=list)

class GenerateNotesRequest(BaseModel):
    video_title: str
    video_id: str
    segments: List[Segment]
    qa_history: List[QAHistoryItem]

class GenerateNotesResponse(BaseModel):
    markdown_notes: str

class PdfKeyframe(BaseModel):
    title: str
    timestamp: float
    caption: str = ""

class DownloadPdfRequest(BaseModel):
    title: str
    markdown_content: str
    video_id: str = ""
    keyframes: List[PdfKeyframe] = Field(default_factory=list)

class ExplainFrameRequest(BaseModel):
    video_id: str
    timestamp: float
    question: Optional[str] = ""
    segment_title: Optional[str] = ""
    segment_summary: Optional[str] = ""
    transcript_excerpt: Optional[str] = ""

class ExplainFrameResponse(BaseModel):
    timestamp: float
    frame_url: str
    explanation: str
    on_screen_text: str = ""
    equations: List[EquationItem] = Field(default_factory=list)
    diagram_description: str = ""
    key_concept: str = ""

class SegmentVisualRequest(BaseModel):
    video_id: str
    start_time: float
    end_time: float
    title: Optional[str] = ""
    summary: Optional[str] = ""

class SegmentVisualResponse(BaseModel):
    timestamp: float
    frame_url: str
    visual: FrameAnalysis
