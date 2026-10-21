"""Fail-fast on invalid Gemini keys, first-review strength, health fields. No live calls."""
import logging
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import _model_race as mr
from app.services import scheduler_service as sched
from app.services.segmenter_service import segmenter_service

NOW = datetime(2026, 10, 21, tzinfo=timezone.utc)
INVALID = "400 INVALID_ARGUMENT. API key not valid. [reason: API_KEY_INVALID]"


@pytest.fixture(autouse=True)
def _reset():
    mr.reset_key_state()
    yield
    mr.reset_key_state()


class TestFirstReviewStrength:
    def test_first_perfect_answer_is_full_strength(self):
        assert sched.update(0.0, 1.0, 0, 0, "CORRECT", 100, NOW).strength == 1.0

    def test_first_partial_seeded_from_score(self):
        assert sched.update(0.0, 1.0, 0, 0, "CORRECT", 70, NOW).strength == pytest.approx(0.7)

    def test_first_failure_seeded_from_score_and_lapses(self):
        st = sched.update(0.9, 1.0, 0, 0, "INCORRECT", 20, NOW)
        assert st.strength == pytest.approx(0.2) and st.lapses == 1

    def test_later_review_still_blends(self):
        st = sched.update(0.5, 2.0, 1, 0, "CORRECT", 100, NOW)
        assert st.strength == pytest.approx(0.4 * 0.5 + 0.6)


class TestRaceFailFast:
    def _run(self, calls, models=("a", "b", "c", "d"), **kw):
        def attempt(name):
            calls.append(name)
            raise RuntimeError(INVALID)
        return mr.race_candidates(list(models), attempt, max_parallel=2, **kw)

    def test_stops_without_trying_tail_models(self):
        calls = []
        assert self._run(calls) is None
        assert "c" not in calls and "d" not in calls
        assert mr.server_key_known_invalid()

    def test_sequential_head_fails_fast(self):
        calls = []
        def attempt(name):
            calls.append(name)
            raise RuntimeError(INVALID)
        assert mr.race_candidates(["a", "b", "c"], attempt, max_parallel=1) is None
        assert calls == ["a"]

    def test_other_errors_still_fall_back(self):
        def attempt(name):
            if name != "c":
                raise RuntimeError("503 unavailable")
            return "ok"
        assert mr.race_candidates(["a", "b", "c"], attempt, max_parallel=2) == "ok"
        assert not mr.server_key_known_invalid()

    def test_per_request_key_does_not_flag_server_key(self):
        self._run([], server_key=False)
        assert not mr.server_key_known_invalid()

    def test_log_rate_limited_and_no_key(self, caplog):
        with caplog.at_level(logging.ERROR, logger=mr.logger.name):
            for _ in range(3):
                self._run([])
        recs = [r for r in caplog.records if "API_KEY_INVALID" in r.getMessage()]
        assert len(recs) == 1


class FakeModels:
    def __init__(self):
        self.calls = []

    def generate_content(self, **kw):
        self.calls.append(kw["model"])
        raise RuntimeError(INVALID)


class FakeClient:
    def __init__(self):
        self.models = FakeModels()


def test_segmenter_invalid_request_key_falls_back_to_heuristics(monkeypatch):
    fake = FakeClient()
    monkeypatch.setattr(segmenter_service, "_get_client", lambda key="": fake)
    from app.models.schemas import TranscriptCue
    cues = [TranscriptCue(text=f"Sentence number {i} about friction.", start=i * 10.0, duration=10.0) for i in range(30)]
    segs, source = segmenter_service.segment_transcript_with_source("vid", "T", cues, "bad-key")
    assert segs and source != "gemini"
    assert len(fake.models.calls) <= 2
    assert not mr.server_key_known_invalid()


def test_health_fields(monkeypatch):
    from app.core.config import settings
    c = TestClient(app)
    monkeypatch.setattr(settings, "google_api_key", "")
    body = c.get("/api/health").json()
    assert body["gemini_key_configured"] is False and "gemini_key_valid" not in body
    monkeypatch.setattr(settings, "google_api_key", "x")
    mr._note_invalid_key(True)
    body = c.get("/api/health").json()
    assert body["gemini_key_configured"] is True and body["gemini_key_valid"] is False
