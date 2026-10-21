import logging
import asyncio
import time
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from fastapi.responses import Response
from typing import Optional
from app.models.schemas import (
    VideoProcessRequest,
    VideoProcessResponse,
    ExplainFrameRequest,
    ExplainFrameResponse,
    SegmentVisualRequest,
    SegmentVisualResponse,
    FrameAnalysis,
)
from app.core.config import settings
from app.core.rate_limit import rate_limit
from app.services.transcript_service import transcript_service
from app.services.segmenter_service import segmenter_service, SEGMENTER_VERSION
from app.services.visual_service import visual_service
from app.services.domain_service import classify_domain

logger = logging.getLogger(__name__)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/video", tags=["Video"])

@router.post("/process", response_model=VideoProcessResponse, dependencies=[Depends(rate_limit("video"))])
async def process_video(
    req: VideoProcessRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key")
):
    video_id = transcript_service.extract_video_id(req.url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL. Please check and try again.")

    t0 = time.monotonic()

    # 1+2. Metadata (oEmbed) and transcript cues are independent network calls
    # — fire them concurrently instead of awaiting one then the other.
    meta_task = asyncio.ensure_future(transcript_service.get_video_metadata(video_id))
    cues_task = asyncio.ensure_future(asyncio.to_thread(transcript_service.fetch_transcript_cues, video_id))

    try:
        meta = await meta_task
        cues = await cues_task
    except Exception:
        logger.exception("Transcript/metadata fetch failed for video %s", video_id)
        raise HTTPException(
            status_code=422,
            detail="Could not retrieve transcripts for this video."
        )
    finally:
        # Never leave the sibling task orphaned if the other one failed.
        for task in (meta_task, cues_task):
            if not task.done():
                task.cancel()
        await asyncio.gather(meta_task, cues_task, return_exceptions=True)
    logger.info(f"[process_video] metadata+transcript fetch took {time.monotonic() - t0:.2f}s")

    # 3. Calculate duration from transcript
    duration = cues[-1].start + cues[-1].duration if cues else 0.0

    # 4. Generate segments
    # The request only carries the URL (the X-Gemini-Key header doesn't change
    # the output), so video_id + segmenter version fully keys the shared cache.
    # Heuristic fallbacks are never cached so a transient Gemini failure can't
    # pin degraded segments.
    t1 = time.monotonic()
    # Domain classification runs alongside segmentation; it never fails the request.
    domain_task = asyncio.ensure_future(
        _resolve_domain_bounded(video_id, meta["title"], cues, x_gemini_key or "")
    )
    try:
        segments = await asyncio.to_thread(
            transcript_service.load_db_segments, video_id, SEGMENTER_VERSION
        )
        if segments:
            logger.info(f"[process_video] reused cached segments for {video_id}")
        else:
            segments, source = await asyncio.to_thread(
                segmenter_service.segment_transcript_with_source,
                video_id=video_id,
                video_title=meta["title"],
                cues=cues,
                custom_api_key=x_gemini_key or ""
            )
            if source == "gemini":
                await asyncio.to_thread(
                    transcript_service.save_db_segments, video_id, SEGMENTER_VERSION, cues, segments
                )
    except BaseException:
        # Never leave the classification task running if segmentation failed or was cancelled.
        domain_task.cancel()
        await asyncio.gather(domain_task, return_exceptions=True)
        raise
    logger.info(f"[process_video] segmentation took {time.monotonic() - t1:.2f}s, total {time.monotonic() - t0:.2f}s")

    return VideoProcessResponse(
        video_id=video_id,
        title=meta["title"],
        author=meta.get("author", ""),
        thumbnail_url=meta.get("thumbnail_url", ""),
        duration=round(duration, 1),
        segments=segments,
        domain=await domain_task,
    )


DOMAIN_TIMEOUT_SECONDS = 5


async def _resolve_domain_bounded(video_id: str, title: str, cues, api_key: str) -> str:
    """Domain classification is best-effort: never wait more than DOMAIN_TIMEOUT_SECONDS."""
    try:
        return await asyncio.wait_for(
            _resolve_domain(video_id, title, cues, api_key), DOMAIN_TIMEOUT_SECONDS
        )
    except asyncio.TimeoutError:
        logger.warning("Domain classification timed out for video %s", video_id)
        return "Other"
    except Exception:
        return "Other"


async def _resolve_domain(video_id: str, title: str, cues, api_key: str) -> str:
    """Cached domain if present, else classify via Gemini (default "Other")."""
    try:
        cached = await asyncio.to_thread(transcript_service.load_db_domain, video_id)
        if cached:
            return cached
        excerpt = " ".join(c.text for c in cues[:60])[:1500]
        domain = await asyncio.to_thread(classify_domain, title, excerpt, api_key)
        if domain != "Other":  # don't pin a possibly degraded result
            await asyncio.to_thread(transcript_service.save_db_domain, video_id, domain)
        return domain
    except Exception:
        logger.warning("Domain resolution failed for video %s", video_id)
        return "Other"


# ── Visual analysis (Gemini vision over extracted frames) ──
# Opt-in and fully degradable: when disabled or the media toolchain is missing,
# these return a clear 503 and the transcript-only flow above is unaffected.

@router.get("/visual/availability")
async def visual_availability():
    """Report whether frame extraction + Gemini vision can run on this server."""
    return visual_service.availability()


@router.get("/frame", dependencies=[Depends(rate_limit("frame", lambda: settings.rate_limit_frame_per_minute))])
async def get_frame(
    video_id: str = Query(..., description="11-char YouTube video id"),
    t: float = Query(..., ge=0, description="Timestamp in seconds"),
):
    """Serve a single extracted JPEG frame (cached) for display in the UI."""
    if not visual_service.availability()["enabled"]:
        raise HTTPException(
            status_code=503,
            detail="Visual analysis is unavailable on this server (disabled or media toolchain not installed).",
        )
    try:
        frame_path = await asyncio.to_thread(visual_service.extract_frame, video_id, t)
    except ValueError:
        logger.warning("Invalid Frame extraction request for video %s", video_id)
        raise HTTPException(status_code=400, detail="Invalid video id or timestamp.")
    except Exception:
        logger.exception("Frame extraction failed for video %s", video_id)
        raise HTTPException(status_code=503, detail="Frame extraction failed.")

    data = await asyncio.to_thread(frame_path.read_bytes)
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/explain-frame", response_model=ExplainFrameResponse, dependencies=[Depends(rate_limit("video"))])
async def explain_frame(
    req: ExplainFrameRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
):
    """Explain what is on screen at a given timestamp, grounded in the segment."""
    if not visual_service.availability()["enabled"]:
        raise HTTPException(
            status_code=503,
            detail="Visual analysis is unavailable on this server (disabled or media toolchain not installed).",
        )
    try:
        result = await asyncio.to_thread(
            visual_service.explain_screen,
            video_id=req.video_id,
            t_seconds=req.timestamp,
            question=req.question or "",
            segment_title=req.segment_title or "",
            segment_summary=req.segment_summary or "",
            transcript_excerpt=req.transcript_excerpt or "",
            custom_api_key=x_gemini_key or "",
        )
    except ValueError:
        logger.warning("Invalid Explain-frame request for video %s", req.video_id)
        raise HTTPException(status_code=400, detail="Invalid video id or timestamp.")
    except Exception:
        logger.exception("Explain-frame failed for video %s", req.video_id)
        raise HTTPException(status_code=503, detail="Explain-frame failed.")

    frame_url = f"/api/video/frame?video_id={req.video_id}&t={req.timestamp}"
    return ExplainFrameResponse(
        timestamp=req.timestamp,
        frame_url=frame_url,
        explanation=result["explanation"],
        on_screen_text=result.get("on_screen_text", ""),
        equations=result.get("equations", []),
        diagram_description=result.get("diagram_description", ""),
        key_concept=result.get("key_concept", ""),
    )


@router.post("/segment-visual", response_model=SegmentVisualResponse, dependencies=[Depends(rate_limit("video"))])
async def segment_visual(
    req: SegmentVisualRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
):
    """Analyze a representative keyframe for a segment (powers keyframe flashcards)."""
    if not visual_service.availability()["enabled"]:
        raise HTTPException(
            status_code=503,
            detail="Visual analysis is unavailable on this server (disabled or media toolchain not installed).",
        )
    try:
        result = await asyncio.to_thread(
            visual_service.segment_visual,
            video_id=req.video_id,
            start_time=req.start_time,
            end_time=req.end_time,
            title=req.title or "",
            summary=req.summary or "",
            custom_api_key=x_gemini_key or "",
        )
    except ValueError:
        logger.warning("Invalid Segment-visual request for video %s", req.video_id)
        raise HTTPException(status_code=400, detail="Invalid video id or timestamp.")
    except Exception:
        logger.exception("Segment-visual failed for video %s", req.video_id)
        raise HTTPException(status_code=503, detail="Segment-visual failed.")

    timestamp = result["timestamp"]
    frame_url = f"/api/video/frame?video_id={req.video_id}&t={timestamp}"
    return SegmentVisualResponse(
        timestamp=timestamp,
        frame_url=frame_url,
        visual=FrameAnalysis(**result["visual"]),
    )
