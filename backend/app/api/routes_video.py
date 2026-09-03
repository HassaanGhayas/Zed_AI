from fastapi import APIRouter, HTTPException, Header
from typing import Optional
from app.models.schemas import VideoProcessRequest, VideoProcessResponse
from app.services.transcript_service import transcript_service
from app.services.segmenter_service import segmenter_service

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
        cues = transcript_service.fetch_transcript_cues(video_id)
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"Could not retrieve transcripts for this video: {str(e)}"
        )

    # 3. Calculate duration from transcript
    duration = cues[-1].start + cues[-1].duration if cues else 0.0

    # 4. Generate segments
    segments = segmenter_service.segment_transcript(
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
