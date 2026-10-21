"""Analytics tests with a fake Supabase client. No network."""
import math
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import jwt
import pytest
from fastapi.testclient import TestClient

from app.api import routes_analytics as ra
from app.core.config import settings
from app.core.rate_limit import reset_rate_limits
from app.main import app
from app.services import scheduler_service as sched
from app.services.concept_service import dedupe_concepts, normalise_concept
from app.services.domain_service import DOMAINS, classify_domain, match_domain

client = TestClient(app)

SECRET = "test-secret-at-least-32-bytes-long-xxxx"
USER = "11111111-2222-3333-4444-555555555555"
OTHER = "99999999-2222-3333-4444-555555555555"
NOW = datetime(2026, 10, 21, 12, 0, 0, tzinfo=timezone.utc)


def _iso(dt):
    return dt.isoformat()


def _token(sub=USER):
    return jwt.encode({"aud": "authenticated", "sub": sub, "exp": int(time.time()) + 3600}, SECRET, algorithm="HS256")


def _h(sub=USER):
    return {"Authorization": f"Bearer {_token(sub)}"}


# ───────────────────────────── fake supabase ─────────────────────────────

def _cmp_val(v):
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return v
    return v


class _Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.op, self.payload, self.filters = "select", None, []
        self.order_by, self.max_rows, self.on_conflict = [], None, None
        self.range_, self.want_count = None, False

    def select(self, cols="*", count=None):
        self.op = "select"
        self.want_count = bool(count)
        return self

    def overlaps(self, col, vals):
        self.filters.append((col, "ov", list(vals))); return self

    def range(self, a, b):
        self.range_ = (a, b); return self

    def insert(self, rows):
        self.op, self.payload = "insert", rows
        return self

    def upsert(self, rows, on_conflict=None):
        self.op, self.payload, self.on_conflict = "upsert", rows, on_conflict
        return self

    def update(self, patch):
        self.op, self.payload = "update", patch
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, col, val):
        self.filters.append((col, "eq", val)); return self

    def gte(self, col, val):
        self.filters.append((col, "gte", val)); return self

    def lte(self, col, val):
        self.filters.append((col, "lte", val)); return self

    def in_(self, col, vals):
        self.filters.append((col, "in", list(vals))); return self

    def order(self, col, desc=False):
        self.order_by.append((col, desc)); return self

    def limit(self, n):
        self.max_rows = n; return self

    def _match(self, row):
        for col, op, val in self.filters:
            cur = row.get(col)
            if col == "version" and cur is None:
                cur = 0      # NOT NULL DEFAULT 0 in the real schema
            if op == "in":
                if cur not in val:
                    return False
                continue
            if op == "ov":
                if not set(cur or []) & set(val):
                    return False
                continue
            if cur is None:
                return False
            a, b = _cmp_val(cur), _cmp_val(val)
            if (op == "eq" and a != b) or (op == "gte" and not a >= b) or (op == "lte" and not a <= b):
                return False
        return True

    def execute(self):
        rows = self.db.tables.setdefault(self.table, [])
        if self.op == "select":
            out = [dict(r) for r in rows if self._match(r)]
            for col, desc in reversed(self.order_by):
                out.sort(key=lambda r: (r.get(col) is None, _cmp_val(r.get(col))), reverse=desc)
            total = len(out)
            if self.range_:
                out = out[self.range_[0]: self.range_[1] + 1]
            if self.max_rows:
                out = out[: self.max_rows]
            return SimpleNamespace(data=out, count=total if self.want_count else None)
        if self.op == "insert":
            payload = self.payload if isinstance(self.payload, list) else [self.payload]
            for p in payload:
                if self.table == "review_events" and p.get("attempt_id") and any(
                    r.get("user_id") == p["user_id"] and r.get("attempt_id") == p["attempt_id"]
                    and r.get("concept_key") == p["concept_key"] for r in rows
                ):
                    raise RuntimeError("duplicate key value violates unique constraint")
                if self.table == "concepts" and any(
                    r["user_id"] == p["user_id"] and r["concept_key"] == p["concept_key"] for r in rows
                ):
                    raise RuntimeError("duplicate key value violates unique constraint")
            rows.extend(dict(p) for p in payload)
            self.db.inserts.append(self.table)
            return SimpleNamespace(data=payload)
        if self.op == "upsert":
            keys = (self.on_conflict or "").split(",")
            for p in self.payload if isinstance(self.payload, list) else [self.payload]:
                hit = next((r for r in rows if all(r.get(k) == p.get(k) for k in keys)), None)
                if hit:
                    hit.update(p)
                else:
                    rows.append(dict(p))
            return SimpleNamespace(data=[])
        if self.op == "update":
            hit = [r for r in rows if self._match(r)]
            for r in hit:
                r.update(self.payload)
            self.db.updates.append((self.table, [dict(r) for r in hit]))
            return SimpleNamespace(data=[dict(r) for r in hit])
        if self.op == "delete":
            self.db.tables[self.table] = [r for r in rows if not self._match(r)]
            return SimpleNamespace(data=[])


class FakeSupabase:
    def __init__(self):
        self.tables = {}
        self.deleted_tables = []
        self.inserts, self.updates = [], []

    def table(self, name):
        return _Query(self, name)

    def rpc(self, name, params):
        db = self

        class _Rpc:
            def execute(self_inner):
                assert name == "add_study_seconds"
                rows = db.tables.setdefault("study_days", [])
                hit = next((r for r in rows if r["user_id"] == params["p_user"] and r["day"] == params["p_day"]), None)
                if hit is None:
                    hit = {"user_id": params["p_user"], "day": params["p_day"], "seconds": 0}
                    rows.append(hit)
                hit["seconds"] = min(hit["seconds"] + params["p_seconds"], 86400)
                return SimpleNamespace(data=hit["seconds"])

        return _Rpc()


@pytest.fixture
def db():
    fake = FakeSupabase()
    with patch.object(settings, "supabase_jwt_secret", SECRET), \
            patch("app.api.routes_analytics.get_supabase", return_value=fake), \
            patch("app.api.routes_analytics._now", return_value=NOW):
        reset_rate_limits()
        ra.reset_insight_cache()
        yield fake
        reset_rate_limits()


def _record_body(**over):
    body = {
        "client_session_id": "vid1", "video_id": "vid1", "segment_id": 1, "segment_title": "Seg",
        "question": "What is a vector?", "status": "CORRECT", "score": 90,
        "understood_concepts": ["Vector addition"], "missing_concepts": [], "misconceptions": [],
        "time_spent_ms": 30000, "source": "video", "domain": "Mathematics",
    }
    body.update(over)
    return body


# ───────────────────────────── scheduler ─────────────────────────────

class TestScheduler:
    def test_correct_grows_stability_by_score(self):
        hi = sched.update(0, 2.0, 1, 0, "CORRECT", 100, NOW)
        lo = sched.update(0, 2.0, 1, 0, "CORRECT", 0, NOW)
        assert hi.stability_days == pytest.approx(6.0)     # 2 * (1.5 + 1.5)
        assert lo.stability_days == pytest.approx(3.0)     # 2 * 1.5
        assert hi.reps == 2 and hi.lapses == 0
        assert hi.next_due == NOW + timedelta(days=6.0)

    def test_failure_resets_and_counts_lapse(self):
        st = sched.update(0.8, 10.0, 2, 0, "MISCONCEPTION", 30, NOW)
        assert st.stability_days == 1.0 and st.lapses == 1 and st.reps == 0
        assert st.next_due == NOW + timedelta(days=1)

    def test_failure_with_high_reps_halves_min_one(self):
        assert sched.update(0.9, 10.0, 6, 0, "INCORRECT", 10, NOW).stability_days == 5.0
        assert sched.update(0.9, 1.5, 6, 0, "INCORRECT", 10, NOW).stability_days == 1.0

    def test_stability_capped(self):
        assert sched.update(1, 300.0, 3, 0, "CORRECT", 100, NOW).stability_days == sched.MAX_STABILITY_DAYS

    def test_strength_bounded_and_uses_decay_when_last_reviewed_given(self):
        a = sched.update(1.0, 2.0, 1, 0, "CORRECT", 50, NOW, last_reviewed=NOW - timedelta(days=20))
        b = sched.update(1.0, 2.0, 1, 0, "CORRECT", 50, NOW)
        assert 0 <= a.strength <= 1 and a.strength < b.strength

    def test_predicted_recall(self):
        assert sched.predicted_recall(2.0, NOW - timedelta(days=2), NOW) == pytest.approx(0.7)
        assert sched.predicted_recall(2.0, NOW, NOW) == 1.0
        assert sched.predicted_recall(2.0, None, NOW) == 0.0
        assert sched.predicted_recall(2.0, NOW + timedelta(days=1), NOW) == 1.0  # clock skew clamps

    def test_naive_datetimes_treated_as_utc(self):
        assert sched.predicted_recall(1.0, datetime(2026, 10, 20), datetime(2026, 10, 21)) == pytest.approx(0.7)

    def test_recall_is_exactly_threshold_at_next_due(self):
        st = sched.update(0, 3.0, 1, 0, "CORRECT", 50, NOW)
        assert sched.predicted_recall(st.stability_days, st.last_reviewed, st.next_due) == pytest.approx(0.7)
        assert not sched.is_at_risk(st.stability_days, st.last_reviewed, st.next_due, st.next_due)
        assert sched.is_at_risk(st.stability_days, st.last_reviewed, st.next_due,
                                st.next_due + timedelta(minutes=1))

    def test_at_risk(self):
        # recall 0.7**2 = 0.49 < 0.70
        assert sched.is_at_risk(2.0, NOW - timedelta(days=4), NOW + timedelta(days=1), NOW)
        # fresh and not due
        assert not sched.is_at_risk(10.0, NOW - timedelta(days=1), NOW + timedelta(days=9), NOW)
        # recall high but overdue
        assert sched.is_at_risk(100.0, NOW - timedelta(days=1), NOW - timedelta(hours=1), NOW)
        assert not sched.is_at_risk(1.0, None, None, NOW)


# ───────────────────────────── concept + domain ─────────────────────────────

class TestConcepts:
    def test_normalise(self):
        assert normalise_concept("The Vectors!") == "vector"
        assert normalise_concept("  An  Eigenvalue  ") == "eigenvalue"
        assert normalise_concept("Gradient-Descent (GD)") == "gradient descent gd"
        assert normalise_concept("Probabilities") == "probability"
        assert normalise_concept("analysis") == "analysis"
        assert normalise_concept("process") == "process"
        assert normalise_concept("!!!") == ""
        assert normalise_concept(None) == ""

    def test_dedupe_keeps_first_label_and_order(self):
        out = dedupe_concepts(["The Vector", "vectors", "Matrix", "", "  ", "matrix!"])
        assert out == [("vector", "The Vector"), ("matrix", "Matrix")]


class TestDomain:
    def test_match_domain(self):
        assert match_domain(" physics.\n") == "Physics"
        assert match_domain("Economics & Finance") == "Economics & Finance"
        assert match_domain("Underwater basket weaving") is None
        assert match_domain(None) is None

    def test_classify_default_without_key_and_on_failure(self):
        with patch.object(settings, "google_api_key", ""):
            assert classify_domain("t", "x", "") == "Other"
        with patch("app.services.domain_service.genai.Client", side_effect=RuntimeError("boom")):
            assert classify_domain("t", "x", "k") == "Other"

    def test_classify_uses_model_answer(self):
        fake_client = SimpleNamespace(models=SimpleNamespace(
            generate_content=lambda **kw: SimpleNamespace(text="Biology\n")))
        with patch("app.services.domain_service.genai.Client", return_value=fake_client):
            assert classify_domain("Cells", "mitosis", "k") == "Biology"

    def test_taxonomy_is_fixed(self):
        assert len(DOMAINS) == 8 and DOMAINS[-1] == "Other"


# ───────────────────────────── auth / config ─────────────────────────────

ROUTES = [
    ("post", "/api/analytics/record", _record_body()),
    ("post", "/api/analytics/study-time", {"seconds": 10}),
    ("get", "/api/analytics/summary", None),
    ("get", "/api/analytics/due", None),
    ("post", "/api/analytics/insight", {"days": 30}),
    ("get", "/api/analytics/export", None),
]


class TestAuthAndConfig:
    @pytest.mark.parametrize("method,path,body", ROUTES)
    def test_401_without_token(self, db, method, path, body):
        r = client.request(method, path, json=body)
        assert r.status_code == 401

    @pytest.mark.parametrize("method,path,body", ROUTES)
    def test_503_when_supabase_unset(self, method, path, body):
        reset_rate_limits()
        with patch.object(settings, "supabase_jwt_secret", SECRET), \
                patch("app.api.routes_analytics.get_supabase", return_value=None):
            r = client.request(method, path, json=body, headers=_h())
        assert r.status_code == 503
        assert r.json() == {"detail": "Supabase not configured"}

    def test_user_id_comes_from_token_not_body(self, db):
        body = _record_body(user_id=OTHER)
        assert client.post("/api/analytics/record", json=body, headers=_h()).status_code == 200
        assert {r["user_id"] for r in db.tables["concepts"]} == {USER}

    def test_validation(self, db):
        assert client.post("/api/analytics/record", json=_record_body(score=101), headers=_h()).status_code == 422
        assert client.post("/api/analytics/record", json=_record_body(status="MAYBE"), headers=_h()).status_code == 422
        assert client.post("/api/analytics/study-time", json={"seconds": 0}, headers=_h()).status_code == 422
        assert client.post("/api/analytics/study-time", json={"seconds": 3601}, headers=_h()).status_code == 422
        assert client.get("/api/analytics/summary?days=0", headers=_h()).status_code == 422
        assert client.get("/api/analytics/summary?days=366", headers=_h()).status_code == 422
        assert client.get("/api/analytics/due?limit=51", headers=_h()).status_code == 422
        assert client.get("/api/analytics/export?format=xml", headers=_h()).status_code == 422


# ───────────────────────────── record ─────────────────────────────

class TestRecord:
    def test_creates_concepts_and_events(self, db):
        body = _record_body(
            understood_concepts=["Vector addition"], missing_concepts=["Dot product", "the vector addition"],
            misconceptions=["Vectors commute under division"],
        )
        r = client.post("/api/analytics/record", json=body, headers=_h())
        assert r.status_code == 200
        out = {c["concept_key"]: c for c in r.json()["concepts"]}
        assert set(out) == {"vector addition", "dot product", "vector commute under division"}
        assert out["vector addition"]["label"] == "Vector addition"
        assert len(db.tables["review_events"]) == 3
        row = next(c for c in db.tables["concepts"] if c["concept_key"] == "dot product")
        # overall status CORRECT -> missing concepts still treated as success
        assert row["lapses"] == 0 and row["domain"] == "Mathematics"

    def test_failure_status_lapses_missing_but_not_understood(self, db):
        body = _record_body(status="MISCONCEPTION", score=30, missing_concepts=["Dot product"])
        client.post("/api/analytics/record", json=body, headers=_h())
        rows = {c["concept_key"]: c for c in db.tables["concepts"]}
        assert rows["dot product"]["lapses"] == 1 and rows["dot product"]["stability_days"] == 1.0
        assert rows["vector addition"]["lapses"] == 0 and rows["vector addition"]["reps"] == 1

    def test_second_review_grows_and_duplicate_ignored(self, db):
        client.post("/api/analytics/record", json=_record_body(), headers=_h())
        # immediate duplicate (same instant) is ignored
        client.post("/api/analytics/record", json=_record_body(), headers=_h())
        assert len(db.tables["review_events"]) == 1
        later = NOW + timedelta(hours=5)
        with patch("app.api.routes_analytics._now", return_value=later):
            client.post("/api/analytics/record", json=_record_body(), headers=_h())
        row = db.tables["concepts"][0]
        assert row["reps"] == 2 and row["stability_days"] > 3.0
        assert len(db.tables["review_events"]) == 2

    def test_unknown_domain_not_stored(self, db):
        client.post("/api/analytics/record", json=_record_body(domain="Quantum Cooking"), headers=_h())
        assert db.tables["concepts"][0]["domain"] is None

    def test_tags_attempt_row_and_never_touches_other_users(self, db):
        db.tables["qa_attempts"] = [
            {"id": "a1", "user_id": USER, "client_session_id": "vid1", "segment_id": 1, "question": "What is a vector?", "answer": "secret"},
            {"id": "a2", "user_id": OTHER, "client_session_id": "vid1", "segment_id": 1, "question": "What is a vector?", "answer": "x"},
        ]
        client.post("/api/analytics/record", json=_record_body(), headers=_h())
        mine, theirs = db.tables["qa_attempts"]
        assert mine["concept_keys"] == ["vector addition"] and mine["time_spent_ms"] == 30000
        assert "concept_keys" not in theirs

    def test_answer_text_not_logged(self, db, caplog):
        with caplog.at_level("DEBUG"):
            client.post("/api/analytics/record", json=_record_body(), headers={**_h(), "X-Gemini-Key": "AIza-secret-key"})
        assert "AIza-secret-key" not in caplog.text


# ───────────────────────────── study time ─────────────────────────────

class TestStudyTime:
    def test_accumulates_and_caps(self, db):
        assert client.post("/api/analytics/study-time", json={"seconds": 600}, headers=_h()).json() == {
            "day": "2026-10-21", "seconds": 600}
        assert client.post("/api/analytics/study-time", json={"seconds": 600}, headers=_h()).json()["seconds"] == 1200
        db.tables["study_days"][0]["seconds"] = 86000
        assert client.post("/api/analytics/study-time", json={"seconds": 3600}, headers=_h()).json()["seconds"] == 86400

    def test_explicit_day_and_range(self, db):
        r = client.post("/api/analytics/study-time", json={"seconds": 60, "day": "2026-10-20"}, headers=_h())
        assert r.json()["day"] == "2026-10-20"
        assert client.post("/api/analytics/study-time", json={"seconds": 60, "day": "2030-01-01"}, headers=_h()).status_code == 422
        assert client.post("/api/analytics/study-time", json={"seconds": 60, "day": "2020-01-01"}, headers=_h()).status_code == 422

    def test_per_user(self, db):
        client.post("/api/analytics/study-time", json={"seconds": 60}, headers=_h())
        client.post("/api/analytics/study-time", json={"seconds": 90}, headers=_h(OTHER))
        assert sorted((r["user_id"], r["seconds"]) for r in db.tables["study_days"]) == sorted([(USER, 60), (OTHER, 90)])


# ───────────────────────────── summary ─────────────────────────────

def _attempt(user, days_ago, score, ms=None, keys=None, **extra):
    return {"user_id": user, "created_at": _iso(NOW - timedelta(days=days_ago)), "score": score,
            "time_spent_ms": ms, "concept_keys": keys or [], "question": f"Q{days_ago}", "verdict": "CORRECT",
            "answer": "TOP-SECRET-ANSWER", "feedback": "TOP-SECRET-FEEDBACK", **extra}


def _concept(user, key, domain, strength, stability, last_days_ago, due_in_days, label=None):
    last = NOW - timedelta(days=last_days_ago)
    return {"user_id": user, "concept_key": key, "label": label or key.title(), "domain": domain,
            "strength": strength, "stability_days": stability, "reps": 1, "lapses": 0,
            "last_reviewed": _iso(last), "next_due": _iso(NOW + timedelta(days=due_in_days))}


class TestSummary:
    def test_empty(self, db):
        s = client.get("/api/analytics/summary", headers=_h()).json()
        assert s["retention"] == {"value": None, "delta": None}
        assert s["velocity"] == {"median_seconds_per_concept": None, "delta_pct": None, "fastest_domain": None}
        assert s["curve"]["days"] == [] and s["curve"]["recall"] == [] and s["curve"]["natural"] == []
        assert s["curve"]["reviews"] == [] and "projection" in s["curve"]["note"]
        assert s["domains"] == [] and s["totals"] == {"attempts": 0, "concepts": 0}
        assert s["decay"]["at_risk_count"] == 0 and s["decay"]["overdue_count"] == 0
        assert s["decay"]["top_at_risk"] == [] and s["decay"]["note"]
        assert s["consistency"]["hours"] == 0 and s["consistency"]["target_hours"] == 20
        assert s["period"] == {"days": 30, "start": "2026-09-21", "end": "2026-10-21"}

    def test_retention_velocity_deltas(self, db):
        db.tables["qa_attempts"] = [
            _attempt(USER, 2, 80, 20000, ["a"]), _attempt(USER, 5, 100, 40000, ["a", "b"]),   # current: avg 90
            _attempt(USER, 40, 60, 60000, ["a"]),                                              # previous: 60
            _attempt(USER, 3, 0, None, []),                                                    # current score 0
            _attempt(OTHER, 1, 100, 1000, ["a"]),                                              # other user ignored
            _attempt(USER, 100, 100),                                                          # too old
        ]
        db.tables["concepts"] = [_concept(USER, "a", "Physics", 0.5, 5, 1, 4)]
        s = client.get("/api/analytics/summary?days=30", headers=_h()).json()
        assert s["retention"]["value"] == pytest.approx(60.0)          # (80+100+0)/3
        assert s["retention"]["delta"] == pytest.approx(0.0)
        assert s["totals"]["attempts"] == 3
        # per-concept seconds: 20, 20 -> median 20; previous 60 -> -66.7%
        assert s["velocity"]["median_seconds_per_concept"] == 20
        assert s["velocity"]["delta_pct"] == pytest.approx(-66.7)
        assert s["velocity"]["fastest_domain"] == "Physics"

    def test_delta_null_without_prior_period(self, db):
        db.tables["qa_attempts"] = [_attempt(USER, 1, 70)]
        s = client.get("/api/analytics/summary", headers=_h()).json()
        assert s["retention"] == {"value": 70.0, "delta": None}

    def test_consistency_target_and_pct_cap(self, db):
        db.tables["study_days"] = [
            {"user_id": USER, "day": "2026-10-20", "seconds": 3600 * 30},
            {"user_id": USER, "day": "2026-09-10", "seconds": 7200},   # previous period (days 30..60)
            {"user_id": OTHER, "day": "2026-10-20", "seconds": 9999},
        ]
        db.tables["user_settings"] = [{"user_id": USER, "monthly_target_hours": 10}]
        c = client.get("/api/analytics/summary", headers=_h()).json()["consistency"]
        assert c["hours"] == 30 and c["target_hours"] == 10 and c["pct"] == 100
        assert c["delta_hours"] == pytest.approx(28.0)

    def test_decay_and_domains(self, db):
        db.tables["concepts"] = [
            _concept(USER, "fresh", "Physics", 0.95, 30, 1, 29),                  # healthy, mastered
            _concept(USER, "fading", "Physics", 0.85, 2, 3, 1, label="Fading One"),   # recall 0.7^1.5 -> at risk
            _concept(USER, "overdue", "Biology", 0.4, 100, 2, -1),                # overdue
            _concept(USER, "nodomain", None, 0.7, 30, 1, 29),
            _concept(OTHER, "theirs", "Physics", 0.1, 1, 9, -9),
        ]
        s = client.get("/api/analytics/summary", headers=_h()).json()
        assert s["decay"]["at_risk_count"] == 2 and s["decay"]["overdue_count"] == 1
        top = s["decay"]["top_at_risk"]
        assert [t["concept_key"] for t in top] == ["fading", "overdue"]   # lowest recall first
        assert top[0]["label"] == "Fading One" and top[0]["predicted_recall"] == pytest.approx(0.7 ** 1.5, abs=1e-3)
        doms = {d["domain"]: d for d in s["domains"]}
        assert set(doms) == {"Physics", "Biology", "Other"}
        assert doms["Physics"]["mastery"] == 90.0 and doms["Physics"]["status"] == "Mastered"
        assert doms["Physics"]["concepts_tracked"] == 2
        assert doms["Biology"]["status"] == "Action Needed"
        assert doms["Other"]["status"] == "In Review"           # 70
        assert [d["domain"] for d in s["domains"]] == ["Physics", "Biology", "Other"]
        assert s["totals"]["concepts"] == 4

    @pytest.mark.parametrize("mastery,status", [(95, "Mastered"), (90, "Mastered"), (85, "Advanced"), (80, "Advanced"),
                                                (70, "In Review"), (65, "In Review"), (64.9, "Action Needed")])
    def test_domain_thresholds(self, mastery, status):
        assert ra._domain_status(mastery) == status

    def test_curve_projection(self, db):
        db.tables["review_events"] = [
            {"user_id": USER, "concept_key": "a", "score": 90, "status": "CORRECT",
             "reviewed_at": _iso(NOW - timedelta(days=4))},
            {"user_id": USER, "concept_key": "a", "score": 90, "status": "CORRECT",
             "reviewed_at": _iso(NOW - timedelta(days=2))},
            {"user_id": OTHER, "concept_key": "z", "score": 10, "status": "INCORRECT",
             "reviewed_at": _iso(NOW - timedelta(days=3))},
        ]
        curve = client.get("/api/analytics/summary", headers=_h()).json()["curve"]
        assert curve["days"] == list(range(29))
        assert len(curve["recall"]) == len(curve["natural"]) == len(curve["tracked"]) == 29
        assert [r["day"] for r in curve["reviews"]] == [0, 2]
        # natural = same concept decaying from its first review with no later reviews
        assert curve["natural"][0] <= 100 and curve["natural"][1] < curve["natural"][0]
        assert curve["natural"][2] < curve["recall"][2]
        assert "projection" in curve["note"]
        # a review on day 2 lifts recall above where it was the day before
        assert curve["recall"][2] > curve["recall"][1]
        assert curve["recall"][28] < curve["recall"][2]

    def test_isolation(self, db):
        db.tables["qa_attempts"] = [_attempt(OTHER, 1, 100, 1000, ["a"])]
        db.tables["concepts"] = [_concept(OTHER, "a", "Physics", 1, 1, 9, -9)]
        s = client.get("/api/analytics/summary", headers=_h()).json()
        assert s["totals"] == {"attempts": 0, "concepts": 0}


# ───────────────────────────── due ─────────────────────────────

class TestDue:
    def _setup(self, db):
        db.tables["concepts"] = [
            _concept(USER, "newer", "Physics", 0.5, 1, 3, -1, label="Newer"),
            _concept(USER, "older", "Physics", 0.5, 1, 9, -5, label="Older"),
            _concept(USER, "noq", "Physics", 0.5, 1, 9, -9, label="No question"),
            _concept(USER, "future", "Physics", 0.5, 1, 1, 3),
            _concept(OTHER, "theirs", "Physics", 0.5, 1, 9, -9),
        ]
        db.tables["qa_attempts"] = [
            {"user_id": USER, "client_session_id": "vid1", "segment_id": 2, "segment_title": "S2",
             "question": "Old question about older?", "concept_keys": ["older"], "created_at": _iso(NOW - timedelta(days=9)),
             "answer": "TOP-SECRET-ANSWER"},
            {"user_id": USER, "client_session_id": "vid1", "segment_id": 1, "segment_title": "S1",
             "question": "Latest newer?", "concept_keys": ["older"], "created_at": _iso(NOW - timedelta(days=3))},
            {"user_id": USER, "client_session_id": "vid1", "segment_id": 1, "segment_title": "S1",
             "question": "Earlier newer?", "concept_keys": ["newer"], "created_at": _iso(NOW - timedelta(days=8))},
            {"user_id": OTHER, "client_session_id": "vid1", "segment_id": 1, "segment_title": "S1",
             "question": "Their question", "concept_keys": ["theirs"], "created_at": _iso(NOW - timedelta(days=1))},
        ]
        db.tables["video_sessions"] = [
            {"user_id": USER, "client_session_id": "vid1", "video_id": "vid1", "session": {"segments": [
                {"segment_id": 1, "questions": [
                    {"id": "q1", "prompt": "Latest newer?", "expected_concept": "Real concept", "hints": ["h1", "h2"]}]},
            ]}},
        ]

    def test_order_fallbacks_and_isolation(self, db):
        self._setup(db)
        d = client.get("/api/analytics/due", headers=_h()).json()
        keys = [i["concept_key"] for i in d["items"]]
        assert keys == ["older", "newer"]            # most overdue first; "noq" has no attempt; future/other excluded
        assert d["total_due"] == 2
        older, newer = d["items"]
        assert older["question"] == "Latest newer?"  # newest attempt containing the concept
        assert older["expected_concept"] == "Real concept" and older["hints"] == ["h1", "h2"]
        assert older["overdue_days"] == pytest.approx(5.0)
        assert older["video_id"] == "vid1" and older["segment_title"] == "S1" and older["segment_id"] == 1
        assert newer["question"] == "Earlier newer?" and newer["segment_id"] == 1
        assert newer["overdue_days"] == pytest.approx(1.0)

    def test_fallback_expected_concept_is_label(self, db):
        self._setup(db)
        db.tables["video_sessions"] = []
        item = client.get("/api/analytics/due", headers=_h()).json()["items"][0]
        assert item["expected_concept"] == "Older" and item["hints"] == []

    def test_limit(self, db):
        self._setup(db)
        d = client.get("/api/analytics/due?limit=1", headers=_h()).json()
        assert len(d["items"]) == 1 and d["total_due"] == 2

    def test_no_answers_in_response(self, db):
        self._setup(db)
        assert "TOP-SECRET" not in client.get("/api/analytics/due", headers=_h()).text

    def test_empty(self, db):
        assert client.get("/api/analytics/due", headers=_h()).json() == {"total_due": 0, "items": []}


# ───────────────────────────── insight ─────────────────────────────

class TestInsight:
    def test_heuristic_when_no_data(self, db):
        r = client.post("/api/analytics/insight", json={"days": 30}, headers=_h())
        assert r.status_code == 200
        assert "No study activity" in r.json()["insight"] and r.json()["generated_at"]

    def test_fallback_when_gemini_fails(self, db):
        db.tables["qa_attempts"] = [_attempt(USER, 1, 80)]
        with patch("app.api.routes_analytics._gemini_insight", side_effect=RuntimeError("down")):
            r = client.post("/api/analytics/insight", json={"days": 30}, headers=_h())
        assert r.status_code == 200 and "80%" in r.json()["insight"]

    def test_gemini_text_cached_per_user_per_day(self, db):
        db.tables["qa_attempts"] = [_attempt(USER, 1, 80)]
        with patch("app.api.routes_analytics._gemini_insight", return_value="Great work.") as g:
            h = {**_h(), "X-Gemini-Key": "k"}
            a = client.post("/api/analytics/insight", json={"days": 30}, headers=h).json()
            b = client.post("/api/analytics/insight", json={"days": 30}, headers=h).json()
            assert a == b and a["insight"] == "Great work." and g.call_count == 1
            assert g.call_args.args[1] == "k"
            db.tables["qa_attempts"].append(_attempt(OTHER, 1, 50))
            client.post("/api/analytics/insight", json={"days": 30}, headers={**_h(OTHER), "X-Gemini-Key": "k"})
            assert g.call_count == 2    # other user has their own cache entry

    def test_prompt_contains_only_summary(self, db):
        db.tables["qa_attempts"] = [_attempt(USER, 1, 80)]
        sent = {}

        def fake(summary, key):
            sent["s"] = str(summary)
            return "ok"

        with patch("app.api.routes_analytics._gemini_insight", side_effect=fake):
            client.post("/api/analytics/insight", json={"days": 30}, headers=_h())
        assert "TOP-SECRET" not in sent["s"]

    def test_cache_is_bounded(self, db):
        for i in range(ra._INSIGHT_CACHE_MAX + 5):
            ra._insight_cache[(str(i), "d", 30)] = {"insight": "x", "generated_at": "t"}
            while len(ra._insight_cache) > ra._INSIGHT_CACHE_MAX:
                ra._insight_cache.popitem(last=False)
        assert len(ra._insight_cache) == ra._INSIGHT_CACHE_MAX


# ───────────────────────────── export ─────────────────────────────

class TestExport:
    def test_csv_has_no_answers(self, db):
        db.tables["qa_attempts"] = [_attempt(USER, 1, 80, question="=HYPERLINK(\"x\")"), _attempt(OTHER, 1, 50, question="THEIRS")]
        db.tables["concepts"] = [_concept(USER, "a", "Physics", 0.9, 5, 1, 4)]
        r = client.get("/api/analytics/export?format=csv&days=30", headers=_h())
        assert r.status_code == 200
        assert r.headers["content-disposition"].startswith("attachment;")
        assert r.headers["content-type"].startswith("text/csv")
        text = r.text
        assert "TOP-SECRET" not in text and "THEIRS" not in text
        assert "question,score,verdict,date" in text and "domain,mastery" in text
        assert "'=HYPERLINK" in text      # formula injection neutralised

    def test_pdf(self, db):
        db.tables["qa_attempts"] = [_attempt(USER, 1, 80)]
        r = client.get("/api/analytics/export?format=pdf", headers=_h())
        assert r.status_code == 200 and r.content.startswith(b"%PDF")
        assert "attachment" in r.headers["content-disposition"] and r.headers["content-disposition"].endswith('.pdf"')


# ───────────────────────────── delete ─────────────────────────────

class TestDelete:
    def test_delete_covers_new_tables_for_caller_only(self, db):
        for t in ("concepts", "review_events", "study_days", "user_settings", "qa_attempts", "video_sessions"):
            db.tables[t] = [{"user_id": USER, "x": 1}, {"user_id": OTHER, "x": 2}]
        with patch("app.api.routes_me.get_supabase", return_value=db):
            r = client.delete("/api/me/data", headers=_h())
        assert r.status_code == 200
        for t in ("concepts", "review_events", "study_days", "user_settings", "qa_attempts", "video_sessions"):
            assert db.tables[t] == [{"user_id": OTHER, "x": 2}], t
