import asyncio
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from google import genai
from app.core.config import settings
from app.core.rate_limit import rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/voice", tags=["Voice"])

TRANSCRIBE_PROMPT = (
    "Transcribe this spoken student answer verbatim. "
    "Output only the transcribed text — no commentary, no quotation marks, no corrections."
)


@router.post("/transcribe", dependencies=[Depends(rate_limit("voice"))])
async def transcribe_audio(
    request: Request,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
):
    """Transcribe a recorded audio answer (raw request body, e.g. audio/webm).

    Used as the voice-input fallback for browsers without the Web Speech API
    (Firefox/Safari). Raw-body upload avoids the python-multipart dependency.
    """
    max_bytes = settings.max_audio_bytes
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > max_bytes:
        raise HTTPException(status_code=413, detail="Audio payload too large.")

    # Stream the body so oversize uploads (or a lying Content-Length) abort early.
    chunks = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > max_bytes:
            raise HTTPException(status_code=413, detail="Audio payload too large.")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio payload.")

    mime = request.headers.get("content-type", "audio/webm")
    if not mime.startswith("audio/"):
        mime = "audio/webm"

    key = (x_gemini_key or "").strip() or settings.google_api_key
    if not key:
        raise HTTPException(status_code=400, detail="No Gemini API key provided.")

    client = genai.Client(api_key=key)
    last_error: Optional[Exception] = None
    for model_name in settings.gemini_candidate_models:
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model_name,
                contents=[
                    TRANSCRIBE_PROMPT,
                    genai.types.Part.from_bytes(data=data, mime_type=mime),
                ],
            )
            text = (response.text or "").strip()
            if text:
                return {"text": text}
        except Exception as e:
            last_error = e
            logger.warning("[Voice] Model %s failed: %s", model_name, e)
            continue

    if last_error is not None:
        logger.error("[Voice] All models failed; last error: %s", last_error)
    raise HTTPException(status_code=502, detail="Transcription failed.")
