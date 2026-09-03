import re
from fastapi import APIRouter, Header, Response
from typing import Optional
from app.models.schemas import GenerateNotesRequest, GenerateNotesResponse, DownloadPdfRequest
from app.services.notes_service import notes_service
from app.services.pdf_service import pdf_service

router = APIRouter(prefix="/api/notes", tags=["Notes"])

@router.post("/generate", response_model=GenerateNotesResponse)
async def generate_notes(
    req: GenerateNotesRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key")
):
    notes = notes_service.generate_personalized_notes(
        video_title=req.video_title,
        video_id=req.video_id,
        segments=req.segments,
        qa_history=req.qa_history,
        custom_api_key=x_gemini_key or ""
    )
    return GenerateNotesResponse(markdown_notes=notes)

@router.post("/download-pdf")
async def download_pdf(req: DownloadPdfRequest):
    pdf_bytes = pdf_service.markdown_to_pdf(
        title=req.title,
        markdown_content=req.markdown_content
    )
    clean_title = re.sub(r'[^a-zA-Z0-9_-]', '_', req.title)[:40]
    filename = f"{clean_title}_Study_Notes.pdf"
    
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition"
        }
    )
