"""Optional Supabase JWT auth. Supabase is optional: no token -> anonymous."""
import asyncio
import logging
import time
from typing import Dict, Optional, Tuple

import jwt
from fastapi import Header, HTTPException, Request
from jwt import PyJWKClient

from app.core.config import settings

logger = logging.getLogger(__name__)

AUDIENCE = "authenticated"
_ASYMMETRIC_ALGS = ["RS256", "ES256", "EdDSA"]

JWKS_TIMEOUT_SECONDS = 5
UNKNOWN_KID_TTL = 300.0
_MAX_UNKNOWN_KIDS = 1024

_jwks_client: Optional[PyJWKClient] = None
_jwks_url: Optional[str] = None
_unknown_kids: Dict[str, float] = {}
_warned = False


def reset_auth_state() -> None:
    global _jwks_client, _jwks_url, _warned
    _jwks_client = None
    _jwks_url = None
    _warned = False
    _unknown_kids.clear()


def warn_if_unverifiable() -> None:
    """One-time startup warning when Supabase is configured but tokens cannot be verified."""
    global _warned
    if _warned:
        return
    if (settings.supabase_service_key or settings.supabase_jwt_secret) and not (
        settings.supabase_url or settings.supabase_jwt_secret
    ):
        _warned = True
        logger.warning(
            "[Auth] Supabase is configured but tokens cannot be verified: set SUPABASE_URL "
            "(JWKS) or SUPABASE_JWT_SECRET (HS256). All callers will be treated as anonymous."
        )
    elif settings.supabase_url and not settings.supabase_jwt_secret:
        _warned = True
        logger.warning(
            "[Auth] SUPABASE_URL set without SUPABASE_JWT_SECRET: only asymmetric (JWKS) "
            "tokens will verify; legacy HS256 tokens are rejected."
        )


def _get_jwks_client() -> Optional[PyJWKClient]:
    global _jwks_client, _jwks_url
    if not settings.supabase_url:
        return None
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    if _jwks_client is None or _jwks_url != url:
        _jwks_client = PyJWKClient(
            url, cache_keys=True, timeout=JWKS_TIMEOUT_SECONDS, lifespan=300
        )
        _jwks_url = url
    return _jwks_client


def _signing_key(client: PyJWKClient, token: str):
    """Return the key for the token's kid using only the cached (lifespan-refreshed) JWKS.

    Never force a refresh for an unknown kid (that would let anyone trigger a
    network fetch per request); unknown kids are negative-cached instead.
    """
    kid = jwt.get_unverified_header(token).get("kid")
    if not isinstance(kid, str) or not kid:
        return None
    now = time.monotonic()
    if _unknown_kids.get(kid, 0.0) > now:
        return None
    for k in client.get_signing_keys():
        if k.key_id == kid:
            return k.key
    if len(_unknown_kids) >= _MAX_UNKNOWN_KIDS:
        stale = [x for x, exp in _unknown_kids.items() if exp <= now] or list(_unknown_kids)[:256]
        for old in stale:
            _unknown_kids.pop(old, None)
    _unknown_kids[kid] = now + UNKNOWN_KID_TTL
    return None


def verify_claims(token: str) -> Optional[dict]:
    """Return the verified claims for a valid Supabase access token, else None.

    Asymmetric tokens are verified against the project's JWKS; HS256 tokens
    (legacy projects) against SUPABASE_JWT_SECRET. Algorithms are pinned per
    path so a token cannot choose its own verification scheme.
    """
    if not token:
        return None
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
    except jwt.PyJWTError:
        return None

    options = {"require": ["exp", "sub"]}
    try:
        if alg == "HS256":
            if not settings.supabase_jwt_secret:
                return None
            claims = jwt.decode(
                token, settings.supabase_jwt_secret, algorithms=["HS256"],
                audience=AUDIENCE, options=options,
            )
        else:
            client = _get_jwks_client()
            if client is None or alg not in _ASYMMETRIC_ALGS:
                return None
            key = _signing_key(client, token)
            if key is None:
                return None
            claims = jwt.decode(
                token, key, algorithms=_ASYMMETRIC_ALGS, audience=AUDIENCE, options=options
            )
    except Exception as e:
        logger.debug(f"[Auth] Token rejected: {type(e).__name__}")
        return None

    sub = claims.get("sub")
    return claims if isinstance(sub, str) and sub else None


def verify_token(token: str) -> Optional[str]:
    claims = verify_claims(token)
    return claims["sub"] if claims else None


def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer":
        return None
    return token.strip()


def user_id_from_authorization(authorization: Optional[str]) -> Optional[str]:
    token = _bearer(authorization)
    return verify_token(token) if token else None


def resolve_auth(request: Request) -> Tuple[Optional[str], bool]:
    """Verify the request's bearer token once; cache (user_id, is_anonymous) on request.state."""
    state = request.state
    if getattr(state, "auth_checked", False):
        return state.user_id, state.user_is_anonymous
    user_id, anon = None, False
    token = _bearer(request.headers.get("authorization"))
    claims = verify_claims(token) if token else None
    if claims:
        user_id = claims["sub"]
        anon = claims.get("is_anonymous") is True
    state.user_id, state.user_is_anonymous, state.auth_checked = user_id, anon, True
    return user_id, anon


async def get_optional_user(
    authorization: Optional[str] = Header(None), request: Request = None
) -> Optional[str]:
    if request is not None:
        return (await asyncio.to_thread(resolve_auth, request))[0]
    return user_id_from_authorization(authorization)


async def get_required_user(
    authorization: Optional[str] = Header(None), request: Request = None
) -> str:
    user_id = await get_optional_user(authorization, request)
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user_id


async def get_registered_user(
    authorization: Optional[str] = Header(None), request: Request = None
) -> str:
    """Like get_required_user, but rejects Supabase anonymous (guest) sessions with 403."""
    if request is None:
        user_id = user_id_from_authorization(authorization)
        anon = False
    else:
        user_id, anon = await asyncio.to_thread(resolve_auth, request)
    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if anon:
        raise HTTPException(status_code=403, detail="Sign in with an account to use this feature.")
    return user_id
