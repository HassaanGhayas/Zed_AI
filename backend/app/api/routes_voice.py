from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Request
from google import genai
from app.core.config import settings

router = APIRouter(prefix="/api/voice", tags=["Voice"])

TRANSCRIBE_PROMPT = (
    "Transcribe this spoken student answer verbatim. "
    "Output only the transcribed text — no commentary, no quotation marks, no corrections."
)


@router.post("/transcribe")
async def transcribe_audio(
    request: Request,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key"),
):
    """Transcribe a recorded audio answer (raw request body, e.g. audio/webm).

    Used as the voice-input fallback for browsers without the Web Speech API
    (Firefox/Safari). Raw-body upload avoids the python-multipart dependency.
    """
    data = await request.body()
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
            response = client.models.generate_content(
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
            print(f"[Voice] Model {model_name} failed: {e}")
            continue

    raise HTTPException(status_code=502, detail=f"Transcription failed: {last_error}")
