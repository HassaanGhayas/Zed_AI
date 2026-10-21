"""Regression tests for the analytics review findings. Fake Supabase, no network."""
import asyncio
import time
from datetime import timedelta
from unittest.mock import patch

import jwt
import pytest

from app.api import routes_analytics as ra
from app.core.config import settings
from app.services import scheduler_service as sched
from tests.test_analytics import (  # noqa: F401  (db is a fixture)
    NOW, OTHER, SECRET, USER, _attempt, _concept, _h, _iso, _record_body, client, db,
)


def _anon_headers():
    tok = jwt.encode(
        {"aud": "authenticated", "sub": USER, "is_anonymous": True, "exp": int(time.time()) + 3600},
        SECRET, algorithm="HS256",
    )
    return {"Authorization": f"Bearer {tok}"}


def _post(body, headers=None):
    return client.post("/api/analytics/record", json=body, headers=headers or _h())


# ───────────────────────────── 1 / 14: review + idempotency ─────────────────────────────

class TestReviewRecord:
    def test_review_applies_to_concept_key_even_without_evaluator_concepts(self, db):
        db.tables["concepts"] = [_concept(USER, "due one", "Physics", 0.5, 1, 3, -1, label="Due One")]
        later = NOW + timedelta(hours=1)
        with patch("app.api.routes_analytics._now", return_value=later):
            r = _post(_record_body(source="review", concept_key="due one", status="CORRECT", score=80,
                                   understood_concepts=[], attempt_id="att-1"))
        assert r.status_code == 200
        row = db.tables["concepts"][0]
        assert row["reps"] == 2 and row["stability_days"] > 1.0
        assert row["next_due"] > _iso(later)
        assert r.json()["concepts"][0]["concept_key"] == "due one"

    def test_review_failure_status_lapses_key_even_if_tagged_understood(self, db):
        db.tables["concepts"] = [_concept(USER, "due one", "Physics", 0.5, 4, 3, -1)]
        _post(_record_body(source="review", concept_key="due one", status="INCORRECT", score=10,
                           understood_concepts=["Due One", "Extra"], attempt_id="att-2"))
        rows = {c["concept_key"]: c for c in db.tables["concepts"]}
        assert rows["due one"]["lapses"] == 1 and rows["due one"]["stability_days"] == 1.0
        assert rows["extra"]["reps"] == 1      # evaluator concepts still follow the old rule

    def test_concept_key_ignored_for_video_source(self, db):
        _post(_record_body(concept_key="ghost"))
        assert {c["concept_key"] for c in db.tables["concepts"]} == {"vector addition"}


class TestIdempotency:
    def test_repeat_attempt_id_is_not_reapplied(self, db):
        body = _record_body(attempt_id="att-x", missing_concepts=["Dot product"])
        first = _post(body).json()
        assert first["replayed"] is False
        with patch("app.api.routes_analytics._now", return_value=NOW + timedelta(hours=9)):
            again = _post(body).json()
        assert again["replayed"] is True
        assert again["concepts"] == first["concepts"]
        assert len(db.tables["review_events"]) == 2
        assert all(c["reps"] == 1 for c in db.tables["concepts"])

    def test_different_attempt_ids_both_apply(self, db):
        _post(_record_body(attempt_id="a"))
        with patch("app.api.routes_analytics._now", return_value=NOW + timedelta(hours=9)):
            _post(_record_body(attempt_id="b"))
        assert db.tables["concepts"][0]["reps"] == 2

    def test_per_user_scoping(self, db):
        _post(_record_body(attempt_id="same"))
        r = _post(_record_body(attempt_id="same"), headers=_h(OTHER))
        assert r.json()["replayed"] is False
        assert len(db.tables["review_events"]) == 2

    def test_cas_conflict_retries_once_then_applies(self, db):
        row = _concept(USER, "vector addition", "Mathematics", 0.5, 2, 1, 1)
        row["version"] = 5
        db.tables["concepts"] = [row]
        real = ra._read_concept
        calls = {"n": 0}

        def stale_first(c, u, k):
            out = real(c, u, k)
            calls["n"] += 1
            if calls["n"] == 1 and out:
                out = {**out, "version": 4}      # someone else wrote in between
            return out

        with patch("app.api.routes_analytics._read_concept", side_effect=stale_first):
            r = _post(_record_body(attempt_id="cas"))
        assert r.status_code == 200
        stored = db.tables["concepts"][0]
        assert stored["version"] == 6 and stored["reps"] == 2
        assert len(db.tables["review_events"]) == 1      # claim released and re-taken, not duplicated

    def test_cas_gives_up_with_500_and_releases_claim(self, db):
        row = _concept(USER, "vector addition", "Mathematics", 0.5, 2, 1, 1)
        row["version"] = 5
        db.tables["concepts"] = [row]
        real = ra._read_concept
        with patch("app.api.routes_analytics._read_concept",
                   side_effect=lambda c, u, k: {**real(c, u, k), "version": 1}):
            r = _post(_record_body(attempt_id="fail"))
        assert r.status_code == 500
        assert db.tables.get("review_events", []) == []   # retry is possible later


# ───────────────────────────── 4: tagging ─────────────────────────────

class TestTagging:
    def _rows(self, n):
        return [
            {"id": f"r{i}", "user_id": USER, "client_session_id": "vid1", "segment_id": 1,
             "question": "What is a vector?", "created_at": _iso(NOW - timedelta(minutes=10 - i))}
            for i in range(n)
        ]

    def test_only_newest_matching_row_updated(self, db):
        db.tables["qa_attempts"] = self._rows(3)
        _post(_record_body(expected_concept="Vectors", hints=["h1"]))
        tagged = [r["id"] for r in db.tables["qa_attempts"] if "concept_keys" in r]
        assert tagged == ["r2"]
        newest = db.tables["qa_attempts"][2]
        assert newest["source"] == "video" and newest["expected_concept"] == "Vectors" and newest["hints"] == ["h1"]

    def test_warns_when_no_row(self, db, caplog):
        with caplog.at_level("WARNING"):
            assert _post(_record_body()).status_code == 200
        assert "No qa_attempts row" in caplog.text

    def test_review_never_relabels_sole_original_row(self, db):
        db.tables["qa_attempts"] = self._rows(1)
        db.tables["concepts"] = [_concept(USER, "k", "Physics", 0.5, 1, 3, -1)]
        _post(_record_body(source="review", concept_key="k", attempt_id="r1"))
        assert "source" not in db.tables["qa_attempts"][0]

    def test_review_tags_newest_when_review_row_exists(self, db):
        db.tables["qa_attempts"] = self._rows(2)
        db.tables["concepts"] = [_concept(USER, "k", "Physics", 0.5, 1, 3, -1)]
        _post(_record_body(source="review", concept_key="k", attempt_id="r1"))
        assert db.tables["qa_attempts"][1]["source"] == "review"
        assert "source" not in db.tables["qa_attempts"][0]


# ───────────────────────────── 5 / 6 / 9 / 10: summary ─────────────────────────────

class TestSummaryFixes:
    def test_study_window_boundaries(self, db):
        # now = 2026-10-21, days=30 -> start.date() = 2026-09-21
        db.tables["study_days"] = [
            {"user_id": USER, "day": "2026-10-21", "seconds": 3600},    # today: current
            {"user_id": USER, "day": "2026-09-22", "seconds": 7200},    # first current day
            {"user_id": USER, "day": "2026-09-21", "seconds": 1800},    # boundary: previous
            {"user_id": USER, "day": "2026-08-23", "seconds": 900},     # first previous day
            {"user_id": USER, "day": "2026-08-22", "seconds": 5000},    # outside both
        ]
        c = client.get("/api/analytics/summary?days=30", headers=_h()).json()["consistency"]
        assert c["hours"] == pytest.approx(3.0)
        assert c["delta_hours"] == pytest.approx(3.0 - 2700 / 3600, abs=0.01)

    def test_fetch_all_paginates(self, db):
        db.tables["concepts"] = [
            {"user_id": USER, "concept_key": f"k{i:03d}"} for i in range(7)
        ]
        rows = ra._fetch_all(
            lambda: db.table("concepts").select("*").eq("user_id", USER).order("concept_key"), page=3
        )
        assert [r["concept_key"] for r in rows] == [f"k{i:03d}" for i in range(7)]

    def test_fetch_all_hard_cap(self, db):
        db.tables["concepts"] = [{"user_id": USER, "concept_key": f"k{i}"} for i in range(10)]
        rows = ra._fetch_all(lambda: db.table("concepts").select("*").eq("user_id", USER), page=2, max_pages=3)
        assert len(rows) == 6

    def test_recall_is_threshold_at_next_due_and_not_at_risk_before(self, db):
        last = NOW - timedelta(days=4)
        db.tables["concepts"] = [{
            "user_id": USER, "concept_key": "edge", "label": "Edge", "domain": "Physics", "strength": 0.5,
            "stability_days": 4.0, "reps": 1, "lapses": 0,
            "last_reviewed": _iso(last), "next_due": _iso(NOW),     # exactly due now
        }]
        d = client.get("/api/analytics/summary", headers=_h()).json()["decay"]
        assert d["at_risk_count"] == 0 and d["overdue_count"] == 0
        assert sched.predicted_recall(4.0, last, NOW) == pytest.approx(0.7)

    def test_curve_seeds_from_stored_concepts_without_jump(self, db):
        db.tables["concepts"] = [
            _concept(USER, "old", "Physics", 0.5, 20.0, 10, 10),     # never reviewed in the window
            _concept(USER, "a", "Physics", 0.5, 2.85, 2, 1),
        ]
        db.tables["review_events"] = [
            {"user_id": USER, "concept_key": "a", "score": 90, "status": "CORRECT",
             "interval_days_before": 1.0, "reviewed_at": _iso(NOW - timedelta(days=4))},
        ]
        curve = client.get("/api/analytics/summary", headers=_h()).json()["curve"]
        assert curve["tracked"][0] == 2          # stored concept counted from day 0
        assert set(curve["tracked"]) == {2}
        assert all(0 <= v <= 100 for v in curve["recall"] + curve["natural"])

    def test_curve_natural_is_data_derived_and_empty_without_events(self, db):
        db.tables["concepts"] = [_concept(USER, "old", "Physics", 0.5, 20.0, 10, 10)]
        curve = client.get("/api/analytics/summary", headers=_h()).json()["curve"]
        assert curve["natural"] == [] and curve["days"] == []

    def test_events_newest_not_dropped_by_cap(self, db):
        events = [
            {"id": f"e{i}", "user_id": USER, "concept_key": "a", "score": 90, "status": "CORRECT",
             "reviewed_at": _iso(NOW - timedelta(hours=i + 1))} for i in range(30)
        ]
        db.tables["review_events"] = events
        rows = ra._fetch_all(
            lambda: db.table("review_events").select("*").eq("user_id", USER).order("reviewed_at", desc=True),
            page=10, max_pages=2,
        )
        assert rows[0]["id"] == "e0"      # newest first, so the cap can only drop the oldest


# ───────────────────────────── 2 / 3 / 7: due ─────────────────────────────

def _att(i, sess, seg, q, keys, days, **extra):
    return {"id": f"x{i}", "user_id": USER, "client_session_id": sess, "segment_id": seg,
            "segment_title": f"S{seg}", "question": q, "concept_keys": keys,
            "created_at": _iso(NOW - timedelta(days=days)), **extra}


class TestDueFixes:
    def _concepts(self, db, *keys):
        db.tables["concepts"] = [
            _concept(USER, k, "Physics", 0.5, 1, 9, -(i + 1), label=k.title()) for i, k in enumerate(keys)
        ]

    def test_one_attempt_many_concepts_is_one_card_but_counts_all(self, db):
        self._concepts(db, "a", "b", "c")
        db.tables["qa_attempts"] = [_att(1, "s1", 1, "Q one?", ["a", "b", "c"], 5)]
        d = client.get("/api/analytics/due", headers=_h()).json()
        assert [i["question"] for i in d["items"]] == ["Q one?"] and d["total_due"] == 3

    def test_dedupe_happens_before_limit(self, db):
        self._concepts(db, "a", "b", "c")
        db.tables["qa_attempts"] = [
            _att(1, "s1", 1, "Q one?", ["a", "b"], 5), _att(2, "s1", 2, "Q two?", ["c"], 6),
        ]
        d = client.get("/api/analytics/due?limit=2", headers=_h()).json()
        assert [i["question"] for i in d["items"]] == ["Q two?", "Q one?"]   # most overdue first

    def test_review_rows_skipped_and_expected_concept_survives(self, db):
        self._concepts(db, "a")
        db.tables["qa_attempts"] = [
            _att(1, "s1", 1, "Orig?", ["a"], 9),
            _att(2, "s1", 0, "Orig?", ["a"], 1, source="review"),      # latest review, segment 0
        ]
        db.tables["video_sessions"] = [{"user_id": USER, "client_session_id": "s1", "video_id": "v1", "session": {
            "segments": [{"segment_id": 1, "questions": [
                {"prompt": "Orig?", "expected_concept": "Real", "hints": ["h"]}]}]}}]
        item = client.get("/api/analytics/due", headers=_h()).json()["items"][0]
        assert item["expected_concept"] == "Real" and item["hints"] == ["h"]
        assert item["segment_id"] == 1 and item["concept_key"] == "a" and item["video_id"] == "v1"

    def test_segment_zero_searches_all_segments(self, db):
        self._concepts(db, "a")
        db.tables["qa_attempts"] = [_att(1, "s1", 0, "Orig?", ["a"], 9)]
        db.tables["video_sessions"] = [{"user_id": USER, "client_session_id": "s1", "video_id": "v1", "session": {
            "segments": [{"segment_id": 3, "questions": [
                {"prompt": "Orig?", "expected_concept": "Real", "hints": []}]}]}}]
        item = client.get("/api/analytics/due", headers=_h()).json()["items"][0]
        assert item["expected_concept"] == "Real" and item["segment_id"] == 3

    def test_stored_columns_used_without_session_json(self, db):
        self._concepts(db, "a")
        db.tables["qa_attempts"] = [_att(1, "s1", 2, "Orig?", ["a"], 9, expected_concept="Stored", hints=["sh"])]
        db.tables["video_sessions"] = [{"user_id": USER, "client_session_id": "s1", "video_id": "v1"}]
        item = client.get("/api/analytics/due", headers=_h()).json()["items"][0]
        assert item["expected_concept"] == "Stored" and item["hints"] == ["sh"] and item["video_id"] == "v1"

    def test_old_attempt_beyond_500_newest_is_still_found(self, db):
        self._concepts(db, "a")
        rows = [_att(i, "s9", 1, f"Filler {i}?", ["zzz"], 1) for i in range(600)]
        rows.append(_att(9999, "s1", 1, "Ancient?", ["a"], 100))
        db.tables["qa_attempts"] = rows
        d = client.get("/api/analytics/due", headers=_h()).json()
        assert [i["question"] for i in d["items"]] == ["Ancient?"]

    def test_total_due_excludes_concepts_without_question(self, db):
        self._concepts(db, "a", "b")
        db.tables["qa_attempts"] = [_att(1, "s1", 1, "Q?", ["a"], 5)]
        assert client.get("/api/analytics/due", headers=_h()).json()["total_due"] == 1


# ───────────────────────────── delete my data ─────────────────────────────

class TestDeleteMyData:
    def test_delete_my_data(self, db):
        with patch("app.api.routes_me.get_supabase", return_value=db):
            assert client.delete("/api/me/data", headers=_h()).status_code == 200


# ───────────────────────────── 19: anonymous tokens ─────────────────────────────

class TestAnonymous:
    @pytest.mark.parametrize("method,path,body", [
        ("post", "/api/analytics/record", _record_body()),
        ("post", "/api/analytics/study-time", {"seconds": 10}),
    ])
    def test_writes_rejected(self, db, method, path, body):
        r = client.request(method, path, json=body, headers=_anon_headers())
        assert r.status_code == 403
        assert not db.tables.get("concepts") and not db.tables.get("study_days")

    @pytest.mark.parametrize("path", ["/api/analytics/summary", "/api/analytics/due"])
    def test_reads_allowed(self, db, path):
        assert client.get(path, headers=_anon_headers()).status_code == 200


# ───────────────────────────── 15: pdf / markdown ─────────────────────────────

class TestExportSafety:
    def test_plain_strips_markup(self):
        out = ra._plain('**bold** <b>x</b> [l](http://e.com/"onclick) `code` $x$ a&b')
        for ch in "*<>[]()`$&\"":
            assert ch not in out
        assert "bold" in out and "code" in out

    def test_markdown_has_sanitised_question(self):
        s = {"period": {"start": "a", "end": "b"}, "retention": {"value": 1}, "consistency": {
            "hours": 0, "target_hours": 1, "pct": 0}, "decay": {"at_risk_count": 0, "overdue_count": 0},
             "totals": {"attempts": 1, "concepts": 0}, "domains": []}
        md = ra.render_markdown(s, [{"question": "<script>*x*</script> [a](http://x)", "score": 1,
                                     "verdict": "CORRECT", "created_at": "2026-01-01"}])
        assert "<" not in md and "[" not in md and "*x*" not in md

    def test_link_regex_excludes_quote(self):
        from app.services.pdf_service import pdf_service
        out = pdf_service._format_inline_markdown('[x](https://e.com/a"b onclick)')
        assert 'href="https://e.com/a"b' not in out

    def test_pdf_falls_back_to_plain_text(self, db):
        db.tables["qa_attempts"] = [_attempt(USER, 1, 80)]
        with patch("app.api.routes_analytics.pdf_service.markdown_to_pdf", side_effect=RuntimeError("boom")):
            r = client.get("/api/analytics/export?format=pdf", headers=_h())
        assert r.status_code == 200 and r.content.startswith(b"%PDF")

    def test_pdf_total_failure_is_safe_500(self, db):
        with patch("app.api.routes_analytics.pdf_service.markdown_to_pdf", side_effect=RuntimeError("boom")), \
                patch("app.api.routes_analytics.pdf_service.plain_text_pdf", side_effect=RuntimeError("boom2")):
            r = client.get("/api/analytics/export?format=pdf", headers=_h())
        assert r.status_code == 500 and r.json() == {"detail": "Could not export analytics."}


# ───────────────────────────── 18: /process domain ─────────────────────────────

class TestProcessDomain:
    def test_domain_timeout_falls_back_to_other(self):
        from app.api import routes_video as rv

        async def slow(*a, **k):
            await asyncio.sleep(10)

        async def run():
            with patch.object(rv, "DOMAIN_TIMEOUT_SECONDS", 0.05), patch.object(rv, "_resolve_domain", slow):
                return await rv._resolve_domain_bounded("v", "t", [], "")

        assert asyncio.run(run()) == "Other"

    def test_domain_task_cancelled_when_segmentation_raises(self):
        from app.api import routes_video as rv
        from app.models.schemas import VideoProcessRequest

        state = {"cancelled": False}

        async def slow_domain(*a, **k):
            try:
                await asyncio.sleep(30)
            except asyncio.CancelledError:
                state["cancelled"] = True
                raise

        class Cue:
            start, duration, text = 0.0, 1.0, "hi"

        async def meta(_):
            return {"title": "T"}

        async def run():
            with patch.object(rv, "_resolve_domain_bounded", slow_domain), \
                    patch.object(rv.transcript_service, "get_video_metadata", meta), \
                    patch.object(rv.transcript_service, "fetch_transcript_cues", return_value=[Cue()]), \
                    patch.object(rv.transcript_service, "load_db_segments", return_value=None), \
                    patch.object(rv.segmenter_service, "segment_transcript_with_source",
                                 side_effect=RuntimeError("seg fail")):
                with pytest.raises(RuntimeError):
                    await rv.process_video(VideoProcessRequest(url="https://youtu.be/abcdefghijk"), None)

        asyncio.run(run())
        assert state["cancelled"] is True
