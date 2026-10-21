from typing import Annotated, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, StringConstraints

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
    title: str = Field(max_length=500)
    start_time: float
    end_time: float
    summary: str = Field(max_length=10_000)
    questions: List[Question] = Field(default_factory=list)
    # Optional visual enrichment (populated only when visual analysis is requested)
    visual: Optional[FrameAnalysis] = None
    keyframe_url: Optional[str] = None
    keyframe_time: Optional[float] = None

class VideoProcessRequest(BaseModel):
    url: str = Field(max_length=2048)

class VideoProcessResponse(BaseModel):
    video_id: str
    title: str
    author: Optional[str] = ""
    thumbnail_url: Optional[str] = ""
    duration: float
    segments: List[Segment]
    domain: Optional[str] = None

class MessageItem(BaseModel):
    role: str = Field(max_length=32)
    content: str = Field(max_length=10_000)

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
    video_id: str = Field(max_length=64)
    segment_id: int
    question_id: str = Field(max_length=128)
    question_prompt: str = Field(max_length=5_000)
    expected_concept: str = Field(max_length=5_000)
    segment_summary: str = Field(max_length=10_000)
    segment_transcript: Optional[str] = Field(default="", max_length=100_000)
    user_answer: str = Field(max_length=10_000)
    attempt_count: int = 1
    chat_history: List[MessageItem] = Field(default_factory=list, max_length=100)
    attempt_history: List[AttemptHistoryItem] = Field(default_factory=list, max_length=20)
    current_question_prompt: Optional[str] = None

class AnswerEvaluationResponse(BaseModel):
    status: Literal["CORRECT", "MISCONCEPTION", "INCORRECT"]
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
    video_title: str = Field(max_length=500)
    video_id: str = Field(max_length=64)
    segments: List[Segment] = Field(max_length=200)
    qa_history: List[QAHistoryItem] = Field(max_length=500)

class GenerateNotesResponse(BaseModel):
    markdown_notes: str

class PdfKeyframe(BaseModel):
    title: str = Field(max_length=500)
    timestamp: float = Field(ge=0, le=86400)
    caption: str = Field(default="", max_length=2000)

class DownloadPdfRequest(BaseModel):
    title: str = Field(max_length=500)
    markdown_content: str = Field(max_length=500_000)
    video_id: str = Field(default="", max_length=64)
    keyframes: List[PdfKeyframe] = Field(default_factory=list, max_length=100)

class ExplainFrameRequest(BaseModel):
    video_id: str = Field(max_length=64)
    timestamp: float = Field(ge=0, le=86400)
    question: Optional[str] = Field(default="", max_length=5_000)
    segment_title: Optional[str] = Field(default="", max_length=500)
    segment_summary: Optional[str] = Field(default="", max_length=10_000)
    transcript_excerpt: Optional[str] = Field(default="", max_length=20_000)

class ExplainFrameResponse(BaseModel):
    timestamp: float
    frame_url: str
    explanation: str
    on_screen_text: str = ""
    equations: List[EquationItem] = Field(default_factory=list)
    diagram_description: str = ""
    key_concept: str = ""

class SegmentVisualRequest(BaseModel):
    video_id: str = Field(max_length=64)
    start_time: float = Field(ge=0, le=86400)
    end_time: float = Field(ge=0, le=86400)
    title: Optional[str] = Field(default="", max_length=500)
    summary: Optional[str] = Field(default="", max_length=10_000)

class SegmentVisualResponse(BaseModel):
    timestamp: float
    frame_url: str
    visual: FrameAnalysis


# ── Analytics ──

ConceptText = Annotated[str, StringConstraints(max_length=500)]


class RecordRequest(BaseModel):
    client_session_id: str = Field(min_length=1, max_length=200)
    video_id: str = Field(max_length=64)
    segment_id: Optional[int] = None
    segment_title: str = Field(default="", max_length=500)
    question: str = Field(max_length=2000)
    status: Literal["CORRECT", "MISCONCEPTION", "INCORRECT"]
    score: int = Field(ge=0, le=100)
    understood_concepts: List[ConceptText] = Field(default_factory=list, max_length=30)
    missing_concepts: List[ConceptText] = Field(default_factory=list, max_length=30)
    misconceptions: List[ConceptText] = Field(default_factory=list, max_length=30)
    time_spent_ms: Optional[int] = Field(default=None, ge=0, le=86_400_000)
    source: Literal["video", "review"] = "video"
    domain: Optional[str] = Field(default=None, max_length=100)
    # Review flow: always apply this result to this stored concept key (success = status == CORRECT).
    concept_key: Optional[str] = Field(default=None, max_length=200)
    # Client-generated id; /record is idempotent per (user, attempt_id).
    attempt_id: Optional[str] = Field(default=None, min_length=1, max_length=100)
    # Optional source-question details stored on the attempt row so /due can rebuild the card.
    expected_concept: Optional[str] = Field(default=None, max_length=500)
    hints: Optional[List[str]] = Field(default=None, max_length=10)
