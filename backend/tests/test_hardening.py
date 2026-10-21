"""API hardening tests: input limits, audio cap, rate limiting, generic errors. No live Gemini calls."""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.rate_limit import reset_rate_limits
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_limits():
    reset_rate_limits()
    yield
    reset_rate_limits()


def _eval_payload(**over):
    p = {
        "video_id": "abc", "segment_id": 1, "question_id": "q1",
        "question_prompt": "Why?", "expected_concept": "x", "segment_summary": "s",
        "user_answer": "because",
    }
    p.update(over)
    return p


class TestSchemaLimits:
    def test_user_answer_too_long(self):
        r = client.post("/api/qa/evaluate", json=_eval_payload(user_answer="a" * 10_001))
        assert r.status_code == 422

    def test_chat_history_too_long(self):
        hist = [{"role": "user", "content": "hi"}] * 101
        r = client.post("/api/qa/evaluate", json=_eval_payload(chat_history=hist))
        assert r.status_code == 422

    def test_url_too_long(self):
        r = client.post("/api/video/process", json={"url": "http://x/" + "a" * 3000})
        assert r.status_code == 422

    def test_markdown_too_long(self):
        r = client.post("/api/notes/download-pdf", json={"title": "t", "markdown_content": "a" * 500_001})
        assert r.status_code == 422

    def test_keyframe_timestamp_bounds(self):
        for ts in (-1, 10**9):
            r = client.post(
                "/api/notes/download-pdf",
                json={"title": "t", "markdown_content": "x", "keyframes": [{"title": "k", "timestamp": ts}]},
            )
            assert r.status_code == 422

    def test_frame_negative_t(self):
        assert client.get("/api/video/frame", params={"video_id": "abc", "t": -5}).status_code == 422


class TestVoice:
    def test_oversize_content_length(self):
        r = client.post("/api/voice/transcribe", content=b"0" * (settings.max_audio_bytes + 1),
                        headers={"content-type": "audio/webm"})
        assert r.status_code == 413

    def test_oversize_streamed_body(self):
        def gen():
            yield b"0" * (settings.max_audio_bytes // 2 + 1)
            yield b"0" * (settings.max_audio_bytes // 2 + 1)
        r = client.post("/api/voice/transcribe", content=gen(), headers={"content-type": "audio/webm"})
        assert r.status_code == 413

    def test_error_detail_is_generic_and_key_not_leaked(self):
        secret = "SECRET-INTERNAL-ERROR-XYZ"
        with patch("app.api.routes_voice.genai.Client") as mock_client:
            mock_client.return_value.models.generate_content.side_effect = RuntimeError(secret)
            r = client.post("/api/voice/transcribe", content=b"1234",
                            headers={"content-type": "audio/webm", "X-Gemini-Key": "k"})
        assert r.status_code == 502
        assert secret not in r.text


class TestGenericErrors:
    def test_transcript_error_not_leaked(self):
        secret = "SECRET-INTERNAL-ERROR-XYZ"
        with patch("app.api.routes_video.transcript_service") as ts:
            ts.extract_video_id.return_value = "abcdefghijk"

            async def meta(_):
                return {"title": "t"}

            ts.get_video_metadata.side_effect = meta
            ts.fetch_transcript_cues.side_effect = RuntimeError(secret)
            r = client.post("/api/video/process", json={"url": "https://youtu.be/abcdefghijk"})
        assert r.status_code == 422
        assert secret not in r.text


class TestRateLimit:
    def test_429_after_limit(self):
        with patch.object(settings, "rate_limit_per_minute", 3):
            codes = [client.post("/api/qa/evaluate", json=_eval_payload(user_answer="x" * 10_001)).status_code
                     for _ in range(5)]
        # Rate limiting runs before body validation completes: first 3 -> 422, rest -> 429
        assert codes.count(429) == 2
        assert 429 not in codes[:3]

    def test_disabled(self):
        with patch.object(settings, "rate_limit_per_minute", 1), patch.object(settings, "rate_limit_enabled", False):
            codes = [client.post("/api/qa/evaluate", json=_eval_payload(user_answer="x" * 10_001)).status_code
                     for _ in range(3)]
        assert 429 not in codes
