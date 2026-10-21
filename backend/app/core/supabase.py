"""Optional Supabase service-role client. Returns None when not configured."""
import logging
from typing import Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

_client: Any = None
_init_failed = False


def get_supabase() -> Optional[Any]:
    """Lazily build the service-role client; None if SUPABASE_URL/SUPABASE_SERVICE_KEY are unset."""
    global _client, _init_failed
    if _client is not None:
        return _client
    if _init_failed or not (settings.supabase_url and settings.supabase_service_key):
        return None
    try:
        from supabase import create_client
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
    except Exception as e:
        _init_failed = True
        logger.warning(f"[Supabase] Could not initialise client: {e}")
        return None
    return _client
