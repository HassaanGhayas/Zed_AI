import logging
import threading
import time
import concurrent.futures
from typing import Callable, List, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

_LOG_INTERVAL_SECONDS = 60.0
_state_lock = threading.Lock()
_last_invalid_log = 0.0
_server_key_invalid = False


def is_invalid_key_error(exc: BaseException) -> bool:
    """True for Gemini 400 API_KEY_INVALID errors (never worth retrying)."""
    text = str(exc)
    return "API_KEY_INVALID" in text or "API key not valid" in text


def server_key_known_invalid() -> bool:
    """Cached state: True only after a failed call with the server key."""
    return _server_key_invalid


def reset_key_state() -> None:
    global _last_invalid_log, _server_key_invalid
    with _state_lock:
        _last_invalid_log = 0.0
        _server_key_invalid = False


def _note_invalid_key(server_key: bool) -> None:
    """Record state and emit a rate-limited log line (no key material)."""
    global _last_invalid_log, _server_key_invalid
    with _state_lock:
        if server_key:
            _server_key_invalid = True
        now = time.monotonic()
        if _last_invalid_log and now - _last_invalid_log < _LOG_INTERVAL_SECONDS:
            return
        _last_invalid_log = now
    which = "server GOOGLE_API_KEY" if server_key else "per-request X-Gemini-Key"
    logger.error("[ModelRace:API_KEY_INVALID] Gemini rejected the %s; failing fast without trying other models.", which)


class _InvalidKey(Exception):
    pass


def race_candidates(
    model_names: List[str],
    attempt_fn: Callable[[str], Optional[T]],
    max_parallel: int = 2,
    server_key: bool = True,
) -> Optional[T]:
    """Try the first `max_parallel` candidate models concurrently; return the
    first success. Falls back to the remaining models sequentially.

    Candidate-model fallback loops that try models strictly one-at-a-time pay
    a full round-trip for every failed/slow model before reaching the next.
    Racing the top candidates hides that tail latency while keeping the
    caller's preferred model order when every model is healthy (the first
    model usually wins the race anyway since it's picked for being fastest
    or most capable).

    A 400 API_KEY_INVALID error is non-retryable: the race aborts immediately
    (returns None) without trying other models. `server_key=False` marks the
    key as a per-request one so it doesn't flag the server key as invalid.

    `attempt_fn` should raise on failure (bad response, timeout, rate limit)
    and return a non-None result on success.
    """
    if not model_names:
        return None

    head, tail = model_names[:max_parallel], model_names[max_parallel:]

    def _log_failure(name: str, exc: Exception) -> None:
        if is_invalid_key_error(exc):
            _note_invalid_key(server_key)
            raise _InvalidKey()
        tag = "RATE_LIMIT" if ("429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc)) else "ERROR"
        logger.warning(f"[ModelRace:{tag}] {name} failed: {exc}")

    try:
        if len(head) > 1:
            # Not a `with` block: ThreadPoolExecutor.__exit__ calls shutdown(wait=True),
            # which would block the first `return` below until the SLOWER model also
            # finishes — defeating the entire point of racing. shutdown(wait=False)
            # lets us return the moment a winner is found; the loser's thread finishes
            # in the background and is discarded.
            pool = concurrent.futures.ThreadPoolExecutor(max_workers=len(head))
            try:
                futures = {pool.submit(attempt_fn, name): name for name in head}
                for future in concurrent.futures.as_completed(futures):
                    name = futures[future]
                    try:
                        result = future.result()
                        if result is not None:
                            return result
                    except Exception as e:
                        _log_failure(name, e)
            finally:
                pool.shutdown(wait=False)
        else:
            for name in head:
                try:
                    result = attempt_fn(name)
                    if result is not None:
                        return result
                except Exception as e:
                    _log_failure(name, e)

        for name in tail:
            try:
                result = attempt_fn(name)
                if result is not None:
                    return result
            except Exception as e:
                _log_failure(name, e)

        return None
    except _InvalidKey:
        return None
