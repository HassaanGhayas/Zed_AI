import asyncio
import csv
import io
import logging
import re
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from app.core.auth import get_registered_user, get_required_user
from app.core.rate_limit import rate_limit
from app.core.supabase import get_supabase
from app.models.schemas import RecordRequest, StudyTimeRequest
from app.services import scheduler_service as sched
from app.services.concept_service import dedupe_concepts
from app.services.domain_service import DOMAINS, match_domain
from app.services.pdf_service import pdf_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])

NOT_CONFIGURED = "Supabase not configured"
CURVE_DAYS = 28
TOP_AT_RISK = 5
PAGE_SIZE = 1000               # PostgREST max-rows default
MAX_PAGES = 20                 # hard cap per paginated read
RECORD_RETRIES = 3
DUE_CONCEPT_PAGES = 2
KEY_CHUNK = 40
DUPLICATE_WINDOW_SECONDS = 2.0
MAX_STUDY_DAY_AGE = 400
DEFAULT_TARGET_HOURS = 20
CURVE_NOTE = (
    "Model projection, not measured data: recall is estimated as 0.7^(days since review / stability) "
    "from your review history, and days after today are extrapolated. 'natural' decays the same "
    "concepts from their first review in this window with no further reviews. Concepts join the "
    "curve at their first review in the window, so the average can rise as new ones are added "
    "(see 'tracked')."
)
DECAY_NOTE = (
    "overdue_count covers every tracked concept past its due date; /due total_due counts only "
    "due concepts that still have a source question, so it can be lower."
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_client():
    client = get_supabase()
    if client is None:
        raise HTTPException(status_code=503, detail=NOT_CONFIGURED)
    return client


def _parse_dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def _rows(res: Any) -> List[Dict[str, Any]]:
    return list(getattr(res, "data", None) or [])


def _fetch_all(build, page: int = PAGE_SIZE, max_pages: int = MAX_PAGES) -> List[Dict[str, Any]]:
    """Paginate with .range() so PostgREST's max-rows cap cannot silently truncate.

    `build` must return a fresh, deterministically ordered query each call.
    """
    out: List[Dict[str, Any]] = []
    for i in range(max_pages):
        rows = _rows(build().range(i * page, (i + 1) * page - 1).execute())
        out.extend(rows)
        if len(rows) < page:
            return out
    logger.warning("Paginated read hit the %d-page cap; results truncated", max_pages)
    return out


# ───────────────────────────── /record ─────────────────────────────

class _Conflict(Exception):
    """Optimistic-concurrency conflict on a concepts row."""


def _concept_result(key: str, row: Dict[str, Any], label: str) -> Dict[str, Any]:
    return {
        "concept_key": key, "label": row.get("label") or label,
        "strength": row.get("strength", 0.0), "next_due": row.get("next_due"),
    }


def _claimed(client, user_id: str, attempt_id: str, key: str) -> bool:
    rows = _rows(
        client.table("review_events").select("id").eq("user_id", user_id)
        .eq("attempt_id", attempt_id).eq("concept_key", key).limit(1).execute()
    )
    return bool(rows)


def _read_concept(client, user_id: str, key: str) -> Optional[Dict[str, Any]]:
    rows = _rows(
        client.table("concepts").select("*").eq("user_id", user_id).eq("concept_key", key).limit(1).execute()
    )
    return rows[0] if rows else None


def _apply_concept(
    client, user_id: str, req: RecordRequest, now: datetime, key: str, label: str,
    success: bool, domain: Optional[str],
) -> Dict[str, Any]:
    """Apply one review to one concept with an optimistic CAS on `version`, retrying on conflict."""
    for attempt in range(RECORD_RETRIES):
        prev = _read_concept(client, user_id, key)
        prev_last = _parse_dt(prev.get("last_reviewed")) if prev else None
        if (
            not req.attempt_id and prev_last
            and abs((now - prev_last).total_seconds()) <= DUPLICATE_WINDOW_SECONDS
        ):
            # Double-submit of the same review: keep the stored state.
            return _concept_result(key, prev, label)

        eff_status = "CORRECT" if success else req.status
        stability_before = float(prev["stability_days"]) if prev and prev.get("stability_days") else 1.0
        state = sched.update(
            strength=float(prev["strength"]) if prev and prev.get("strength") is not None else 0.0,
            stability_days=stability_before,
            reps=int(prev.get("reps") or 0) if prev else 0,
            lapses=int(prev.get("lapses") or 0) if prev else 0,
            status=eff_status,
            score=req.score,
            now=now,
            last_reviewed=prev_last,
        )
        row = {
            "label": (prev.get("label") if prev else None) or label,
            "domain": domain or (prev.get("domain") if prev else None),
            "strength": state.strength,
            "stability_days": state.stability_days,
            "reps": state.reps,
            "lapses": state.lapses,
            "last_reviewed": _iso(state.last_reviewed),
            "next_due": _iso(state.next_due),
        }
        event = {
            "user_id": user_id, "concept_key": key, "score": req.score, "status": eff_status,
            "source": req.source, "interval_days_before": stability_before, "reviewed_at": _iso(now),
        }
        claimed = False
        if req.attempt_id:
            event["attempt_id"] = req.attempt_id
            try:   # claim first: the unique index makes a concurrent twin request fail here
                client.table("review_events").insert(event).execute()
                claimed = True
            except Exception:
                if _claimed(client, user_id, req.attempt_id, key):
                    cur = _read_concept(client, user_id, key)
                    return _concept_result(key, cur or row, label)
                raise
        try:
            if prev:
                version = int(prev.get("version") or 0)
                done = _rows(
                    client.table("concepts").update({**row, "version": version + 1})
                    .eq("user_id", user_id).eq("concept_key", key).eq("version", version).execute()
                )
                if not done:
                    raise _Conflict()
            else:
                client.table("concepts").insert(
                    {"user_id": user_id, "concept_key": key, "version": 1, **row}
                ).execute()
        except Exception as e:
            if claimed:
                try:
                    client.table("review_events").delete().eq("user_id", user_id) \
                        .eq("attempt_id", req.attempt_id).eq("concept_key", key).execute()
                except Exception:
                    logger.warning("Could not release review event claim")
            if attempt + 1 < RECORD_RETRIES:
                logger.info("Concept write conflict (%s); retrying", type(e).__name__)
                continue
            raise
        if not req.attempt_id:
            client.table("review_events").insert(event).execute()
        return _concept_result(key, row, label)
    raise _Conflict()


def _tag_attempt(client, user_id: str, req: RecordRequest, keys: List[str]) -> None:
    """Best effort: tag only the newest matching synced attempt row."""
    try:
        q = (
            client.table("qa_attempts").select("id")
            .eq("user_id", user_id)
            .eq("client_session_id", req.client_session_id)
            .eq("question", req.question)
        )
        if req.segment_id is not None:
            q = q.eq("segment_id", req.segment_id)
        matches = _rows(q.order("created_at", desc=True).limit(2).execute())
        if req.source == "review" and len(matches) < 2:
            # A single match is the original video attempt; never relabel it as a review.
            return
        if not matches:
            logger.warning("No qa_attempts row found to tag with concept keys")
            return
        patch: Dict[str, Any] = {"concept_keys": keys, "source": req.source}
        if req.time_spent_ms is not None:
            patch["time_spent_ms"] = req.time_spent_ms
        if req.expected_concept:
            patch["expected_concept"] = req.expected_concept[:500]
        if req.hints:
            patch["hints"] = [h[:500] for h in req.hints if isinstance(h, str)][:10]
        client.table("qa_attempts").update(patch).eq("user_id", user_id).eq("id", matches[0]["id"]).execute()
    except Exception:
        logger.warning("Could not tag qa_attempts with concept keys")


def _record_sync(client, user_id: str, req: RecordRequest, now: datetime) -> Dict[str, Any]:
    items = dedupe_concepts(
        list(req.understood_concepts) + list(req.missing_concepts) + list(req.misconceptions)
    )
    forced = (req.concept_key or "").strip() if req.source == "review" else ""
    if forced:
        items = [(forced, forced)] + [(k, l) for k, l in items if k != forced]
    items = items[:60]
    if not items:
        return {"concepts": [], "replayed": False}
    understood = {k for k, _ in dedupe_concepts(req.understood_concepts)}
    keys = [k for k, _ in items]
    domain = match_domain(req.domain)

    replayed = False
    if req.attempt_id:
        done = _rows(
            client.table("review_events").select("concept_key").eq("user_id", user_id)
            .eq("attempt_id", req.attempt_id).execute()
        )
        replayed = bool(done) and {d["concept_key"] for d in done} >= set(keys)

    result: List[Dict[str, Any]] = []
    for key, label in items:
        if replayed:
            result.append(_concept_result(key, _read_concept(client, user_id, key) or {}, label))
            continue
        if forced and key == forced:
            success = req.status == "CORRECT"
        else:
            success = key in understood or req.status == "CORRECT"
        result.append(_apply_concept(client, user_id, req, now, key, label, success, domain))

    if not replayed:
        _tag_attempt(client, user_id, req, keys)
    return {"concepts": result, "replayed": replayed}


@router.post("/record", dependencies=[Depends(rate_limit("analytics"))])
async def record_attempt(req: RecordRequest, user_id: str = Depends(get_registered_user)):
    client = _require_client()
    try:
        return await asyncio.to_thread(_record_sync, client, user_id, req, _now())
    except Exception:
        logger.exception("Analytics record failed")
        raise HTTPException(status_code=500, detail="Could not record this attempt.")


# ───────────────────────────── /study-time ─────────────────────────────

@router.post("/study-time", dependencies=[Depends(rate_limit("analytics"))])
async def add_study_time(req: StudyTimeRequest, user_id: str = Depends(get_registered_user)):
    client = _require_client()
    today = _now().date()
    day = req.day or today
    if day > today + timedelta(days=1) or day < today - timedelta(days=MAX_STUDY_DAY_AGE):
        raise HTTPException(status_code=422, detail="day is out of range.")
    try:
        res = await asyncio.to_thread(
            lambda: client.rpc(
                "add_study_seconds",
                {"p_user": user_id, "p_day": day.isoformat(), "p_seconds": req.seconds},
            ).execute()
        )
    except Exception:
        logger.exception("add_study_seconds failed")
        raise HTTPException(status_code=500, detail="Could not record study time.")
    data = getattr(res, "data", None)
    if isinstance(data, list):
        data = data[0] if data else None
    if isinstance(data, dict):
        data = next(iter(data.values()), None)
    try:
        total = min(int(data), 86400)
    except (TypeError, ValueError):
        total = req.seconds
    return {"day": day.isoformat(), "seconds": total}


# ───────────────────────────── summary ─────────────────────────────

def _median(values: List[float]) -> Optional[float]:
    return statistics.median(values) if values else None


def _mean(values: List[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def _round(x: Optional[float], nd: int = 1) -> Optional[float]:
    return None if x is None else round(x, nd)


def _domain_status(mastery: float) -> str:
    if mastery >= 90:
        return "Mastered"
    if mastery >= 80:
        return "Advanced"
    if mastery >= 65:
        return "In Review"
    return "Action Needed"


def _recall(stability: float, last: datetime, at: datetime) -> float:
    return sched.predicted_recall(stability, last, at)


def build_curve(
    events: List[Dict[str, Any]], now: datetime, concepts: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """Projected 28-day recall curve (a model projection, not measured data).

    Day 0 is the first review in the last 28 days. Each concept with in-window
    reviews is replayed through the scheduler (seeded with the stability stored
    on its first event) and joins the curve at that first review. Tracked
    concepts with no in-window reviews are seeded from their stored state and
    count from day 0, so the mean does not jump when old concepts "appear".
    Recall is 0.7 ** (elapsed / stability) everywhere. `natural` decays the same
    concepts from their first in-window review with no later reviews.
    `tracked` is the number of concepts averaged on each day.
    """
    empty = {"days": [], "recall": [], "natural": [], "reviews": [], "tracked": [], "note": CURVE_NOTE}
    window_start = now - timedelta(days=CURVE_DAYS)
    parsed = []
    for e in events:
        t = _parse_dt(e.get("reviewed_at"))
        if t and window_start <= t <= now and e.get("concept_key"):
            parsed.append((t, e))
    if not parsed:
        return empty
    parsed.sort(key=lambda p: p[0])

    day0 = parsed[0][0].date()
    origin = datetime(day0.year, day0.month, day0.day, tzinfo=timezone.utc)

    timelines: Dict[str, List[Tuple[datetime, float]]] = {}   # key -> [(time, stability after)]
    running: Dict[str, Any] = {}
    review_counts: Dict[int, int] = {}
    for t, e in parsed:
        key = e["concept_key"]
        cur = running.get(key)
        seed = e.get("interval_days_before")
        seed_stability = float(seed) if isinstance(seed, (int, float)) and seed > 0 else 1.0
        st = sched.update(
            strength=cur.strength if cur else 0.0,
            stability_days=cur.stability_days if cur else seed_stability,
            reps=cur.reps if cur else 0,
            lapses=cur.lapses if cur else 0,
            status=e.get("status") or "INCORRECT",
            score=int(e.get("score") or 0),
            now=t,
        )
        running[key] = st
        timelines.setdefault(key, []).append((t, st.stability_days))
        d = (t.date() - day0).days
        review_counts[d] = review_counts.get(d, 0) + 1

    static: Dict[str, Tuple[datetime, float]] = {}   # tracked, not reviewed in the window
    for c in concepts or []:
        key = c.get("concept_key")
        last = _parse_dt(c.get("last_reviewed"))
        stability = c.get("stability_days")
        if key and key not in timelines and last and isinstance(stability, (int, float)) and stability > 0:
            static[key] = (last, float(stability))

    days, recall, natural, tracked = [], [], [], []
    for d in range(CURVE_DAYS + 1):
        t_d = origin + timedelta(days=d + 1) - timedelta(seconds=1)
        actual, baseline = [], []
        for lst in timelines.values():
            latest = None
            for t, s in lst:
                if t <= t_d:
                    latest = (t, s)
            if latest:
                actual.append(_recall(latest[1], latest[0], t_d))
                baseline.append(_recall(lst[0][1], lst[0][0], t_d))
        for last, s in static.values():
            if last <= t_d:
                r = _recall(s, last, t_d)
                actual.append(r)
                baseline.append(r)
        days.append(d)
        recall.append(round((_mean(actual) or 0.0) * 100, 1))
        natural.append(round((_mean(baseline) or 0.0) * 100, 1))
        tracked.append(len(actual))

    reviews = [
        {"day": d, "label": f"{n} concept{'s' if n != 1 else ''} reviewed"}
        for d, n in sorted(review_counts.items()) if d <= CURVE_DAYS
    ]
    return {
        "days": days, "recall": recall, "natural": natural, "reviews": reviews,
        "tracked": tracked, "note": CURVE_NOTE,
    }


def build_summary(
    days: int,
    now: datetime,
    attempts: List[Dict[str, Any]],
    concepts: List[Dict[str, Any]],
    events: List[Dict[str, Any]],
    study_rows: List[Dict[str, Any]],
    target_hours: Optional[int],
) -> Dict[str, Any]:
    """Pure aggregation. `attempts` should cover the current and previous period."""
    start = now - timedelta(days=days)
    prev_start = now - timedelta(days=2 * days)

    concept_domain: Dict[str, str] = {}
    for c in concepts:
        if c.get("concept_key") and c.get("domain"):
            concept_domain[c["concept_key"]] = c["domain"]

    cur, prev = [], []
    for a in attempts:
        t = _parse_dt(a.get("created_at"))
        if t is None:
            continue
        if start <= t <= now:
            cur.append(a)
        elif prev_start <= t < start:
            prev.append(a)

    def scores(rows):
        return [float(r["score"]) for r in rows if isinstance(r.get("score"), (int, float))]

    def per_concept_seconds(rows):
        out = []
        for r in rows:
            ms = r.get("time_spent_ms")
            if isinstance(ms, (int, float)) and ms > 0:
                out.append((r, ms / 1000.0 / max(len(r.get("concept_keys") or []), 1)))
        return out

    cur_ret, prev_ret = _mean(scores(cur)), _mean(scores(prev))
    retention = {
        "value": _round(cur_ret),
        "delta": _round(cur_ret - prev_ret) if cur_ret is not None and prev_ret is not None else None,
    }

    cur_vel = per_concept_seconds(cur)
    cur_med = _median([s for _, s in cur_vel])
    prev_med = _median([s for _, s in per_concept_seconds(prev)])
    by_domain: Dict[str, List[float]] = {}
    for row, secs in cur_vel:
        dom = next((concept_domain[k] for k in (row.get("concept_keys") or []) if k in concept_domain), None)
        if dom:
            by_domain.setdefault(dom, []).append(secs)
    fastest = min(by_domain, key=lambda d: _median(by_domain[d])) if by_domain else None
    velocity = {
        "median_seconds_per_concept": _round(cur_med),
        "delta_pct": _round((cur_med - prev_med) / prev_med * 100) if cur_med is not None and prev_med else None,
        "fastest_domain": fastest,
    }

    # Whole-day windows: current = start.date() < day <= now.date(); previous is the same width before it.
    start_d, prev_start_d, today_d = start.date(), prev_start.date(), now.date()
    cur_secs = prev_secs = 0
    for r in study_rows:
        try:
            d = date.fromisoformat(str(r.get("day")))
        except ValueError:
            continue
        secs = int(r.get("seconds") or 0)
        if start_d < d <= today_d:
            cur_secs += secs
        elif prev_start_d < d <= start_d:
            prev_secs += secs
    monthly = target_hours or DEFAULT_TARGET_HOURS
    target = round(monthly * days / 30.0, 1)
    hours = cur_secs / 3600.0
    consistency = {
        "hours": round(hours, 2),
        "target_hours": target,
        "pct": round(min(100.0, hours / target * 100), 1) if target > 0 else 0.0,
        "delta_hours": round((cur_secs - prev_secs) / 3600.0, 2),
    }

    at_risk, overdue = [], 0
    for c in concepts:
        last, due = _parse_dt(c.get("last_reviewed")), _parse_dt(c.get("next_due"))
        stability = c.get("stability_days") or 1.0
        if due and due < now:
            overdue += 1
        if sched.is_at_risk(stability, last, due, now):
            at_risk.append((sched.predicted_recall(stability, last, now), c, due))
    at_risk.sort(key=lambda x: x[0])
    decay = {
        "at_risk_count": len(at_risk),
        "overdue_count": overdue,
        "top_at_risk": [
            {
                "concept_key": c["concept_key"], "label": c.get("label") or c["concept_key"],
                "domain": c.get("domain"), "predicted_recall": round(r, 3), "next_due": _iso(due),
            }
            for r, c, due in at_risk[:TOP_AT_RISK]
        ],
        "note": DECAY_NOTE,
    }
    at_risk_keys = {c["concept_key"] for _, c, _ in at_risk}

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for c in concepts:
        grouped.setdefault(c.get("domain") or "Other", []).append(c)
    order = {d: i for i, d in enumerate(DOMAINS)}
    domains = []
    for dom in sorted(grouped, key=lambda d: (order.get(d, len(order)), d)):
        cs = grouped[dom]
        mastery = round((_mean([float(c.get("strength") or 0.0) for c in cs]) or 0.0) * 100, 1)
        status = _domain_status(mastery)
        n_risk = sum(1 for c in cs if c["concept_key"] in at_risk_keys)
        note = f"{n_risk} of {len(cs)} concepts at risk of fading." if n_risk else f"{len(cs)} concepts holding steady."
        domains.append({
            "domain": dom, "mastery": mastery, "concepts_tracked": len(cs),
            "status": status, "note": note,
        })

    return {
        "period": {"days": days, "start": start.date().isoformat(), "end": now.date().isoformat()},
        "retention": retention,
        "velocity": velocity,
        "consistency": consistency,
        "decay": decay,
        "curve": build_curve(events, now, concepts),
        "domains": domains,
        "totals": {"attempts": len(cur), "concepts": len(concepts)},
    }


def _fetch_summary(client, user_id: str, days: int, now: datetime) -> Dict[str, Any]:
    prev_start = now - timedelta(days=2 * days)
    attempts = _fetch_all(
        lambda: client.table("qa_attempts")
        .select("score,created_at,time_spent_ms,concept_keys")
        .eq("user_id", user_id).gte("created_at", _iso(prev_start))
        .order("created_at", desc=True).order("id", desc=False)
    )
    concepts = _fetch_all(
        lambda: client.table("concepts").select("*").eq("user_id", user_id)
        .order("concept_key", desc=False)
    )
    # Newest first so a page cap can only drop the oldest events; replay needs ascending order.
    events = _fetch_all(
        lambda: client.table("review_events")
        .select("concept_key,score,status,reviewed_at,interval_days_before")
        .eq("user_id", user_id).gte("reviewed_at", _iso(now - timedelta(days=CURVE_DAYS)))
        .order("reviewed_at", desc=True).order("id", desc=False)
    )
    events.reverse()
    study = _fetch_all(
        lambda: client.table("study_days").select("day,seconds")
        .eq("user_id", user_id).gte("day", prev_start.date().isoformat()).order("day", desc=False)
    )
    settings_rows = _rows(
        client.table("user_settings").select("monthly_target_hours").eq("user_id", user_id).limit(1).execute()
    )
    target = settings_rows[0].get("monthly_target_hours") if settings_rows else None
    return build_summary(days, now, attempts, concepts, events, study, target)


@router.get("/summary", dependencies=[Depends(rate_limit("analytics"))])
async def get_summary(days: int = Query(30, ge=1, le=365), user_id: str = Depends(get_required_user)):
    client = _require_client()
    try:
        return await asyncio.to_thread(_fetch_summary, client, user_id, days, _now())
    except Exception:
        logger.exception("Analytics summary failed")
        raise HTTPException(status_code=500, detail="Could not load analytics.")


# ───────────────────────────── /due ─────────────────────────────

def _find_question(session: Any, segment_id: Any, question: str) -> Dict[str, Any]:
    """Look up the original question in a stored session. segment_id 0/None searches every segment."""
    segments = session.get("segments") if isinstance(session, dict) else None
    for seg in segments or []:
        if not isinstance(seg, dict):
            continue
        if segment_id and seg.get("segment_id") != segment_id:
            continue
        for q in seg.get("questions") or []:
            if isinstance(q, dict) and q.get("prompt") == question:
                return {
                    "segment_id": seg.get("segment_id"),
                    "expected_concept": q.get("expected_concept") or "",
                    "hints": [h for h in (q.get("hints") or []) if isinstance(h, str)],
                }
    return {}


def _safe_key(key: Any) -> bool:
    return isinstance(key, str) and bool(key) and not re.search(r'[{}",\\]', key)


def _source_attempts(client, user_id: str, keys: List[str]) -> Dict[str, Dict[str, Any]]:
    """Newest original (non-review) attempt tagged with each due concept key."""
    chosen: Dict[str, Dict[str, Any]] = {}
    wanted = {k for k in keys if _safe_key(k)}
    ordered = sorted(wanted)
    for i in range(0, len(ordered), KEY_CHUNK):
        chunk = ordered[i:i + KEY_CHUNK]
        rows = _fetch_all(
            lambda: client.table("qa_attempts")
            .select("id,client_session_id,segment_id,segment_title,question,concept_keys,created_at,"
                    "source,expected_concept,hints")
            .eq("user_id", user_id).overlaps("concept_keys", chunk)
            .order("created_at", desc=True).order("id", desc=False),
            max_pages=5,
        )
        for a in rows:                         # newest first
            if a.get("source") == "review" or not a.get("question"):
                continue
            for k in a.get("concept_keys") or []:
                if k in wanted and k not in chosen:
                    chosen[k] = a
    return chosen


def _fetch_due(client, user_id: str, limit: int, now: datetime) -> Dict[str, Any]:
    due = _fetch_all(
        lambda: client.table("concepts").select("*").eq("user_id", user_id)
        .lte("next_due", _iso(now)).order("next_due", desc=False).order("concept_key", desc=False),
        max_pages=DUE_CONCEPT_PAGES,
    )
    if not due:
        return {"total_due": 0, "items": []}
    chosen = _source_attempts(client, user_id, [c["concept_key"] for c in due])

    total_due = 0
    cards: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    seen = set()
    for c in due:                                # most overdue first
        a = chosen.get(c["concept_key"])
        if not a:
            continue
        total_due += 1
        card_id = (a.get("client_session_id") or "", a.get("segment_id") or 0, a["question"])
        if card_id in seen:                      # one attempt tagged with many concepts -> one card
            continue
        seen.add(card_id)
        cards.append((c, a))
    selected = cards[:limit]

    sessions: Dict[str, Dict[str, Any]] = {}
    session_ids = sorted({a["client_session_id"] for _, a in selected if a.get("client_session_id")})
    if session_ids:
        need_json = any(not a.get("expected_concept") for _, a in selected)
        cols = "client_session_id,video_id,session" if need_json else "client_session_id,video_id"
        for r in _rows(
            client.table("video_sessions").select(cols)
            .eq("user_id", user_id).in_("client_session_id", session_ids).execute()
        ):
            sessions[r["client_session_id"]] = r

    items = []
    for c, a in selected:
        sess = sessions.get(a.get("client_session_id") or "", {})
        found = {} if a.get("expected_concept") else _find_question(sess.get("session"), a.get("segment_id"), a["question"])
        due_at = _parse_dt(c.get("next_due")) or now
        label = c.get("label") or c["concept_key"]
        hints = a.get("hints") if isinstance(a.get("hints"), list) else None
        items.append({
            "concept_key": c["concept_key"],
            "label": label,
            "domain": c.get("domain"),
            "question": a["question"],
            "expected_concept": a.get("expected_concept") or found.get("expected_concept") or label,
            "hints": [h for h in (hints or found.get("hints") or []) if isinstance(h, str)],
            "segment_id": a.get("segment_id") or found.get("segment_id") or 0,
            "segment_title": a.get("segment_title") or "",
            "video_id": sess.get("video_id") or a.get("client_session_id") or "",
            "next_due": _iso(due_at),
            "overdue_days": round(max((now - due_at).total_seconds(), 0.0) / 86400.0, 2),
        })
    return {"total_due": total_due, "items": items}


@router.get("/due", dependencies=[Depends(rate_limit("analytics"))])
async def get_due(limit: int = Query(20, ge=1, le=50), user_id: str = Depends(get_required_user)):
    client = _require_client()
    try:
        return await asyncio.to_thread(_fetch_due, client, user_id, limit, _now())
    except Exception:
        logger.exception("Analytics due failed")
        raise HTTPException(status_code=500, detail="Could not load review items.")


# ───────────────────────────── /export ─────────────────────────────

def _csv_cell(value: Any) -> Any:
    """Neutralise spreadsheet formula injection in user-derived text."""
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


_MD_SPECIALS = re.compile(r"[*_`#<>\[\]()$\\|~&\"{}]")


def _plain(text: Any, limit: int = 200) -> str:
    """Plain text safe to embed in markdown/PDF: no markup characters, one line."""
    cleaned = _MD_SPECIALS.sub(" ", str(text or ""))
    return re.sub(r"\s+", " ", cleaned).strip()[:limit]


def _fetch_recent_attempts(client, user_id: str, days: int, now: datetime) -> List[Dict[str, Any]]:
    # Deliberately excludes `answer` and `feedback`.
    return _rows(
        client.table("qa_attempts").select("question,score,verdict,created_at")
        .eq("user_id", user_id).gte("created_at", _iso(now - timedelta(days=days)))
        .order("created_at", desc=True).limit(200).execute()
    )


def render_csv(summary: Dict[str, Any], attempts: List[Dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    p, r, v = summary["period"], summary["retention"], summary["velocity"]
    c, d = summary["consistency"], summary["decay"]
    w.writerow(["Studify AI progress summary"])
    w.writerow(["period_start", p["start"]])
    w.writerow(["period_end", p["end"]])
    w.writerow(["retention_avg_score", r["value"]])
    w.writerow(["retention_delta", r["delta"]])
    w.writerow(["median_seconds_per_concept", v["median_seconds_per_concept"]])
    w.writerow(["study_hours", c["hours"]])
    w.writerow(["target_hours", c["target_hours"]])
    w.writerow(["consistency_pct", c["pct"]])
    w.writerow(["concepts_at_risk", d["at_risk_count"]])
    w.writerow(["concepts_overdue", d["overdue_count"]])
    w.writerow([])
    w.writerow(["domain", "mastery", "concepts_tracked", "status"])
    for row in summary["domains"]:
        w.writerow([_csv_cell(row["domain"]), row["mastery"], row["concepts_tracked"], row["status"]])
    w.writerow([])
    w.writerow(["question", "score", "verdict", "date"])
    for a in attempts:
        w.writerow([_csv_cell(a.get("question") or ""), a.get("score"), _csv_cell(a.get("verdict") or ""), a.get("created_at")])
    return buf.getvalue()


def render_markdown(summary: Dict[str, Any], attempts: List[Dict[str, Any]]) -> str:
    p, r, c, d = summary["period"], summary["retention"], summary["consistency"], summary["decay"]
    lines = [
        f"## Summary ({p['start']} to {p['end']})",
        f"- Average score: {r['value'] if r['value'] is not None else 'n/a'}",
        f"- Study time: {c['hours']} of {c['target_hours']} target hours ({c['pct']}%)",
        f"- Concepts at risk: {d['at_risk_count']} (overdue: {d['overdue_count']})",
        f"- Attempts: {summary['totals']['attempts']}, concepts tracked: {summary['totals']['concepts']}",
        "## Domains",
    ]
    lines += [
        f"- {_plain(row['domain'], 100)}: {row['mastery']}% mastery, {row['concepts_tracked']} concepts ({row['status']})"
        for row in summary["domains"]
    ] or ["- No domains tracked yet."]
    lines.append("## Recent attempts")
    lines += [
        f"- {_plain(a.get('question'))} - score {a.get('score')}, {_plain(a.get('verdict'), 30) or 'n/a'}, {str(a.get('created_at') or '')[:10]}"
        for a in attempts[:50]
    ] or ["- No attempts in this period."]
    return "\n".join(lines)


def _render_pdf(summary: Dict[str, Any], attempts: List[Dict[str, Any]]) -> bytes:
    title = "Studify AI Progress Report"
    md = render_markdown(summary, attempts)
    try:
        return pdf_service.markdown_to_pdf(title, md)
    except Exception:
        logger.exception("Rich analytics PDF failed; falling back to plain text")
        plain = "\n".join(re.sub(r"^#+\s*", "", line).lstrip("- ") for line in md.splitlines())
        return pdf_service.plain_text_pdf(title, plain)


@router.get("/export", dependencies=[Depends(rate_limit("analytics_export"))])
async def export_analytics(
    format: str = Query("csv", pattern="^(csv|pdf)$"),
    days: int = Query(30, ge=1, le=365),
    user_id: str = Depends(get_required_user),
):
    client = _require_client()
    now = _now()
    try:
        summary = await asyncio.to_thread(_fetch_summary, client, user_id, days, now)
        attempts = await asyncio.to_thread(_fetch_recent_attempts, client, user_id, days, now)
        if format == "csv":
            body: Any = render_csv(summary, attempts).encode("utf-8")
            media = "text/csv; charset=utf-8"
        else:
            body = await asyncio.to_thread(_render_pdf, summary, attempts)
            media = "application/pdf"
    except Exception:
        logger.exception("Analytics export failed")
        raise HTTPException(status_code=500, detail="Could not export analytics.")
    filename = f"studify-progress-{now.date().isoformat()}.{format}"
    return Response(
        content=body, media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
