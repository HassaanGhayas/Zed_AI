import asyncio
from fastapi import APIRouter, HTTPException, Header, Query
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
from app.services.transcript_service import transcript_service
from app.services.segmenter_service import segmenter_service
from app.services.visual_service import visual_service

router = APIRouter(prefix="/api/video", tags=["Video"])

@router.post("/process", response_model=VideoProcessResponse)
async def process_video(
    req: VideoProcessRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key")
):
    video_id = transcript_service.extract_video_id(req.url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL. Please check and try again.")

    # 1. Fetch metadata
    meta = await transcript_service.get_video_metadata(video_id)
    
    # 2. Fetch transcript cues
    try:
        cues = await asyncio.to_thread(transcript_service.fetch_transcript_cues, video_id)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Could not retrieve transcripts for this video: {str(e)}"
        )

    # 3. Calculate duration from transcript
    duration = cues[-1].start + cues[-1].duration if cues else 0.0

    # 4. Generate segments
    segments = await asyncio.to_thread(
        segmenter_service.segment_transcript,
        video_id=video_id,
        video_title=meta["title"],
        cues=cues,
        custom_api_key=x_gemini_key or ""
    )

    return VideoProcessResponse(
        video_id=video_id,
        title=meta["title"],
        author=meta.get("author", ""),
        thumbnail_url=meta.get("thumbnail_url", ""),
        duration=round(duration, 1),
        segments=segments
    )


# ── Visual analysis (Gemini vision over extracted frames) ──
# Opt-in and fully degradable: when disabled or the media toolchain is missing,
# these return a clear 503 and the transcript-only flow above is unaffected.

@router.get("/visual/availability")
async def visual_availability():
    """Report whether frame extraction + Gemini vision can run on this server."""
    return visual_service.availability()


@router.get("/frame")
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

    data = await asyncio.to_thread(frame_path.read_bytes)
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("/explain-frame", response_model=ExplainFrameResponse)
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

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


@router.post("/segment-visual", response_model=SegmentVisualResponse)
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

    timestamp = result["timestamp"]
    frame_url = f"/api/video/frame?video_id={req.video_id}&t={timestamp}"
    return SegmentVisualResponse(
        timestamp=timestamp,
        frame_url=frame_url,
        visual=FrameAnalysis(**result["visual"]),
    )
