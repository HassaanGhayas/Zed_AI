import concurrent.futures
from typing import Callable, List, Optional, TypeVar

T = TypeVar("T")


def race_candidates(
    model_names: List[str],
    attempt_fn: Callable[[str], Optional[T]],
    max_parallel: int = 2,
) -> Optional[T]:
    """Try the first `max_parallel` candidate models concurrently; return the
    first success. Falls back to the remaining models sequentially.

    Candidate-model fallback loops that try models strictly one-at-a-time pay
    a full round-trip for every failed/slow model before reaching the next.
    Racing the top candidates hides that tail latency while keeping the
    caller's preferred model order when every model is healthy (the first
    model usually wins the race anyway since it's picked for being fastest
    or most capable).

    `attempt_fn` should raise on failure (bad response, timeout, rate limit)
    and return a non-None result on success.
    """
    if not model_names:
        return None

    head, tail = model_names[:max_parallel], model_names[max_parallel:]

    def _log_failure(name: str, exc: Exception) -> None:
        tag = "RATE_LIMIT" if ("429" in str(exc) or "RESOURCE_EXHAUSTED" in str(exc)) else "ERROR"
        print(f"[ModelRace:{tag}] {name} failed: {exc}")

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
