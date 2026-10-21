"""Simple in-memory sliding-window rate limiter (no extra dependency).

Applied to all expensive endpoints (segmentation, frame extraction, vision,
voice, notes/PDF, Q&A evaluation) regardless of whether the caller supplies
their own X-Gemini-Key, since frame/PDF work costs server CPU either way.

Order: a per-IP ceiling is always enforced first, BEFORE any token
verification, so unauthenticated callers cannot force JWKS work. Then callers
with a verified, non-anonymous Supabase token are limited per user id; all
others (including anonymous Supabase JWTs) per client IP.

State is per-process: with multiple workers each enforces its own window.
The IP is request.client.host; behind a reverse proxy run uvicorn with
--proxy-headers (and --forwarded-allow-ips) so this is the real client IP.
"""
import asyncio
import time
from collections import defaultdict, deque
from typing import Callable, Deque, Dict, Optional, Tuple

from fastapi import HTTPException, Request

from app.core.auth import resolve_auth
from app.core.config import settings

WINDOW_SECONDS = 60.0
_MAX_KEYS = 10_000
IP_CEILING_MULTIPLIER = 4  # shared-NAT headroom; real users are limited per user id below it

_hits: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)


def reset_rate_limits() -> None:
    _hits.clear()


def _check(key: Tuple[str, str], limit: int, now: float) -> None:
    if len(_hits) > _MAX_KEYS:
        for k in [k for k, q in _hits.items() if not q or now - q[-1] > WINDOW_SECONDS]:
            _hits.pop(k, None)
    q = _hits[key]
    while q and now - q[0] > WINDOW_SECONDS:
        q.popleft()
    if len(q) >= limit:
        retry_after = max(1, int(WINDOW_SECONDS - (now - q[0])) + 1)
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please slow down and try again shortly.",
            headers={"Retry-After": str(retry_after)},
        )
    q.append(now)


def rate_limit(scope: str, per_minute: Optional[Callable[[], int]] = None) -> Callable:
    """FastAPI dependency factory. `per_minute` is a callable so settings are read at request time."""

    async def _dep(request: Request) -> None:
        if not settings.rate_limit_enabled:
            return
        limit = per_minute() if per_minute else settings.rate_limit_per_minute
        ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        _check((scope, f"ceiling:{ip}"), limit * IP_CEILING_MULTIPLIER, now)

        user_id, anonymous = None, False
        if request.headers.get("authorization"):
            user_id, anonymous = await asyncio.to_thread(resolve_auth, request)
        if user_id and not anonymous:
            _check((scope, f"user:{user_id}"), limit, now)
        else:
            _check((scope, ip), limit, now)

    return _dep
