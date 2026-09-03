import json
import re
from typing import List, Optional
from google import genai
from google.genai import types
from app.core.config import settings
from app.models.schemas import AnswerEvaluationResponse, MessageItem

class EvaluatorService:
    def __init__(self):
        pass

    def _get_client(self, custom_api_key: str = "") -> genai.Client:
        key = custom_api_key.strip() if custom_api_key else settings.google_api_key
        return genai.Client(api_key=key)

    def evaluate_answer(
        self,
        question_prompt: str,
        expected_concept: str,
        segment_summary: str,
        segment_transcript: str,
        user_answer: str,
        attempt_count: int = 1,
        chat_history: Optional[List[MessageItem]] = None,
        custom_api_key: str = ""
    ) -> AnswerEvaluationResponse:
        """Evaluate student answer against expected concept and video segment context."""
        cleaned_answer = user_answer.strip()
        if not cleaned_answer:
            return AnswerEvaluationResponse(
                status="INCORRECT",
                is_correct=False,
                feedback="Please share your thoughts or explanation to proceed.",
                follow_up_prompt="What was the main mechanism or interaction explained in this segment?"
            )

        # 1. Try Gemini evaluation across candidate models
        try:
            client = self._get_client(custom_api_key)
            system_prompt = """You are a master Socratic tutor specializing in active recall and conceptual understanding.
Your goal is to evaluate the student's answer constructively:
1. Determine if the student grasped the essential concept (CORRECT) or if they hold a misconception or gap in understanding (MISCONCEPTION / INCORRECT).
2. If the student accurately explains the mechanism (even in simple or colloquial terms), be generous and mark it CORRECT.
3. If CORRECT:
   - Set status to "CORRECT" and is_correct to true.
   - Give encouraging feedback highlighting what they understood well.
   - follow_up_prompt should be null.
4. If MISCONCEPTION / INCORRECT:
   - Identify precisely where their mental model diverges from the concept.
   - Clarify the misconception gently in 1-2 sentences using intuitive reasoning.
   - follow_up_prompt must be a natural, self-contained question focusing on the missing link (e.g. "What force causes the surfaces to resist sliding?"). Do NOT wrap the original question in quotes.

Output must be JSON with the following schema:
{
  "status": "CORRECT" | "MISCONCEPTION" | "INCORRECT",
  "is_correct": boolean,
  "feedback": "string containing encouraging feedback or specific misconception diagnosis",
  "follow_up_prompt": "string with targeted guiding question, or null"
}
"""
            user_payload = f"""Topic Context: {segment_summary}
Reference Transcript Excerpt: {segment_transcript[:2000]}
Question Prompt: {question_prompt}
Expected Core Concept: {expected_concept}
Student's Attempt #{attempt_count}: {cleaned_answer}
"""
            for model_name in settings.gemini_candidate_models:
                try:
                    response = client.models.generate_content(
                        model=model_name,
                        contents=f"{system_prompt}\n\n{user_payload}",
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json"
                        )
                    )
                    raw_text = response.text.strip()
                    if raw_text.startswith("```"):
                        raw_text = re.sub(r"^```(?:json)?\n?", "", raw_text)
                        raw_text = re.sub(r"\n?```$", "", raw_text)
                    
                    data = json.loads(raw_text)
                    return AnswerEvaluationResponse(
                        status=data.get("status", "INCORRECT"),
                        is_correct=bool(data.get("is_correct", False)),
                        feedback=data.get("feedback", "Good explanation! You captured the essential mechanism."),
                        follow_up_prompt=data.get("follow_up_prompt")
                    )
                except Exception as model_err:
                    print(f"[EvaluatorService] Model {model_name} evaluation failed: {model_err}")
                    continue

        except Exception as e:
            print(f"[EvaluatorService] All Gemini calls failed ({e}). Falling back to heuristic evaluation.")

        # 2. Intelligent heuristic fallback evaluation
        words = re.findall(r'\b[a-zA-Z]{3,}\b', cleaned_answer.lower())
        word_count = len(words)
        
        stopwords = {
            "the", "and", "that", "this", "with", "from", "for", "are", "have",
            "been", "was", "were", "what", "which", "there", "their", "they",
            "can", "will", "would", "about", "into", "also", "some", "like"
        }
        user_keywords = set(w for w in words if w not in stopwords)

        # Context vocabulary from summary, question, and expected concepts
        context_blob = f"{segment_summary} {expected_concept} {question_prompt}".lower()
        context_keywords = set(re.findall(r'\b[a-zA-Z]{3,}\b', context_blob)) - stopwords

        overlap = user_keywords & context_keywords

        # Substantive explanation check:
        # If user writes a good paragraph (>12 words) containing domain keywords or explanation terms
        is_substantive = word_count >= 12 and (len(overlap) >= 2 or any(
            k in cleaned_answer.lower()
            for k in ["force", "oppose", "motion", "resist", "friction", "surface", "rub", "move", "speed", "energy", "contact"]
        ))

        if is_substantive or attempt_count >= 3:
            matched_preview = ", ".join(list(overlap)[:3]) if overlap else "the underlying principles"
            return AnswerEvaluationResponse(
                status="CORRECT",
                is_correct=True,
                feedback=f"Excellent explanation! You clearly grasped the core mechanism: you connected {matched_preview} and explained how the interaction occurs.",
                follow_up_prompt=None
            )
        else:
            return AnswerEvaluationResponse(
                status="MISCONCEPTION",
                is_correct=False,
                feedback="You're getting close, but try explaining the physical cause more specifically: what happens at the surface or contact point to cause this effect?",
                follow_up_prompt="What specific interaction or force occurs between the surfaces to cause this?"
            )

evaluator_service = EvaluatorService()
