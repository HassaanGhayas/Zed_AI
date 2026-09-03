"""Unit tests for Pydantic schema models — validation and defaults."""
import pytest
from app.models.schemas import (
    TranscriptCue,
    Question,
    Segment,
    VideoProcessRequest,
    AnswerEvaluationResponse,
    QAHistoryItem,
    MessageItem,
)


class TestTranscriptCue:
    def test_valid_cue(self):
        cue = TranscriptCue(start=1.5, duration=3.0, text="Hello world")
        assert cue.start == 1.5
        assert cue.duration == 3.0
        assert cue.text == "Hello world"

    def test_missing_required_field_raises(self):
        with pytest.raises(Exception):
            TranscriptCue(start=0.0, duration=1.0)  # missing text


class TestQuestion:
    def test_defaults_empty_hints(self):
        q = Question(id="q1", prompt="What is X?", expected_concept="X is Y")
        assert q.hints == []

    def test_with_hints(self):
        q = Question(
            id="q1", prompt="What is X?",
            expected_concept="X is Y",
            hints=["Think about Y", "Consider Z"]
        )
        assert len(q.hints) == 2


class TestSegment:
    def test_defaults_empty_questions(self):
        seg = Segment(
            segment_id=1, title="Intro",
            start_time=0.0, end_time=60.0, summary="Overview"
        )
        assert seg.questions == []

    def test_with_questions(self):
        q = Question(id="q1", prompt="What?", expected_concept="Concept")
        seg = Segment(
            segment_id=1, title="Intro",
            start_time=0.0, end_time=60.0, summary="Overview",
            questions=[q]
        )
        assert len(seg.questions) == 1


class TestVideoProcessRequest:
    def test_valid_request(self):
        req = VideoProcessRequest(url="https://youtu.be/dQw4w9WgXcQ")
        assert "dQw4w9WgXcQ" in req.url

    def test_missing_url_raises(self):
        with pytest.raises(Exception):
            VideoProcessRequest()


class TestAnswerEvaluationResponse:
    def test_correct_response(self):
        resp = AnswerEvaluationResponse(
            status="CORRECT", is_correct=True,
            feedback="Well done!", follow_up_prompt=None
        )
        assert resp.is_correct is True

    def test_incorrect_response(self):
        resp = AnswerEvaluationResponse(
            status="INCORRECT", is_correct=False,
            feedback="Not quite."
        )
        assert resp.is_correct is False
        assert resp.follow_up_prompt is None


class TestQAHistoryItem:
    def test_default_attempts(self):
        item = QAHistoryItem(
            segment_title="Intro", question="What?",
            user_final_answer="Answer", ai_feedback="Good"
        )
        assert item.attempts == 1

    def test_custom_attempts(self):
        item = QAHistoryItem(
            segment_title="Intro", question="What?",
            user_final_answer="Answer", ai_feedback="Good",
            attempts=3
        )
        assert item.attempts == 3


class TestMessageItem:
    def test_valid_message(self):
        msg = MessageItem(role="user", content="Hello")
        assert msg.role == "user"
        assert msg.content == "Hello"
