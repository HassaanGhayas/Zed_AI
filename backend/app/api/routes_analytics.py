import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import get_registered_user, get_required_user
from app.core.rate_limit import rate_limit
from app.core.supabase import get_supabase
from app.models.schemas import RecordRequest
from app.services import scheduler_service as sched
from app.services.concept_service import dedupe_concepts
from app.services.domain_service import match_domain

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])

NOT_CONFIGURED = "Supabase not configured"
PAGE_SIZE = 1000               # PostgREST max-rows default
MAX_PAGES = 20                 # hard cap per paginated read
RECORD_RETRIES = 3
DUE_CONCEPT_PAGES = 2
KEY_CHUNK = 40
DUPLICATE_WINDOW_SECONDS = 2.0


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
