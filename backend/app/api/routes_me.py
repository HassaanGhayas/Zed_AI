import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_required_user
from app.core.rate_limit import rate_limit
from app.core.supabase import get_supabase

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/me", tags=["Me"])


def _delete_user_rows(client, user_id: str) -> None:
    for table in (
        "qa_attempts", "video_sessions",
        "concepts", "review_events", "study_days", "user_settings",
    ):
        client.table(table).delete().eq("user_id", user_id).execute()


@router.delete("/data", dependencies=[Depends(rate_limit("me"))])
async def delete_my_data(user_id: str = Depends(get_required_user)):
    """Delete all of the caller's synced sessions, Q&A attempts and analytics rows."""
    client = get_supabase()
    if client is None:
        raise HTTPException(status_code=503, detail="Cloud sync is not configured on this server.")
    try:
        await asyncio.to_thread(_delete_user_rows, client, user_id)
    except Exception:
        logger.exception("Failed to delete user data")
        raise HTTPException(status_code=500, detail="Could not delete your data. Please try again.")
    return {"status": "deleted"}
