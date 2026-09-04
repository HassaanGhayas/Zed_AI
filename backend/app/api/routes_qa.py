import asyncio
from fastapi import APIRouter, Header
from typing import Optional
from app.models.schemas import AnswerEvaluationRequest, AnswerEvaluationResponse
from app.services.evaluator_service import evaluator_service

router = APIRouter(prefix="/api/qa", tags=["QA"])

@router.post("/evaluate", response_model=AnswerEvaluationResponse)
async def evaluate_answer(
    req: AnswerEvaluationRequest,
    x_gemini_key: Optional[str] = Header(None, alias="X-Gemini-Key")
):
    result = await asyncio.to_thread(
        evaluator_service.evaluate_answer,
        question_prompt=req.question_prompt,
        expected_concept=req.expected_concept,
        segment_summary=req.segment_summary,
        segment_transcript=req.segment_transcript or "",
        user_answer=req.user_answer,
        attempt_count=req.attempt_count,
        chat_history=req.chat_history,
        custom_api_key=x_gemini_key or ""
    )
    return result
