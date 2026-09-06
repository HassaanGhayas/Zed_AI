import json
import re
from typing import Any, Dict, List, Optional
from google import genai
from google.genai import types
from app.core.config import settings
from app.models.schemas import AnswerEvaluationResponse, AttemptHistoryItem, MessageItem

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
        attempt_history: Optional[List[Any]] = None,
        current_question_prompt: Optional[str] = None,
        custom_api_key: str = ""
    ) -> AnswerEvaluationResponse:
        """Evaluate student answer against expected concept and video segment context,
        tracking concept acquisition, misconceptions, and dynamic retry questions."""
        cleaned_answer = user_answer.strip()
        active_question = current_question_prompt.strip() if (current_question_prompt and current_question_prompt.strip()) else question_prompt

        # Max retries ceiling rule
        is_final_attempt = attempt_count >= 3

        if not cleaned_answer:
            return AnswerEvaluationResponse(
                status="INCORRECT",
                is_correct=False,
                score=0,
                feedback="Please share your thoughts or explanation to proceed.",
                understood_concepts=[],
                missing_concepts=[expected_concept],
                misconceptions=[],
                retry_question="What was the main mechanism or interaction explained in this segment?",
                can_advance=is_final_attempt,
                needs_review=is_final_attempt,
                follow_up_prompt="What was the main mechanism or interaction explained in this segment?"
            )

        # 1. Try Gemini evaluation across candidate models
        try:
            client = self._get_client(custom_api_key)
            system_prompt = """You are a master Socratic tutor specializing in active recall, concept extraction, and adaptive feedback.
Your goal is to evaluate the student's conceptual answer rigorously yet supportively:
1. Determine if the student grasped the essential concept (CORRECT) or holds a gap/misconception (MISCONCEPTION / INCORRECT).
2. Assess conceptual mastery and output:
   - status: "CORRECT" | "MISCONCEPTION" | "INCORRECT"
   - is_correct: boolean (true ONLY if essential concept is understood)
   - score: integer from 0 to 100 representing mastery
   - feedback: 2-3 warm, specific sentences. Acknowledge what they got right, then gently clarify gaps or flawed assumptions.
   - understood_concepts: list of concise strings (concepts or mechanisms the student explained correctly)
   - missing_concepts: list of concise strings (key ideas or terms they missed)
   - misconceptions: list of concise strings (flawed mental models or incorrect assumptions detected)
   - retry_question: (string or null).
     * If is_correct is true OR this is attempt #3 (final attempt): null.
     * If attempt 1: rephrase question to gently guide toward missing concepts.
     * If attempt 2: generate a NARROWER, targeted question specifically addressing the identified misconception (e.g. "Let's look at this part: what force acts at the surface contact points?").
   - can_advance: boolean (true if is_correct is true OR attempt_count >= 3)
   - needs_review: boolean (true if is_correct is false AND attempt_count >= 3)

CRITICAL RULES:
- NEVER mark is_correct=true simply because attempt_count >= 3. If they are wrong on attempt 3, set is_correct=false, can_advance=true, needs_review=true.
- Do NOT wrap retry_question in quotes.

Output must be valid JSON matching this schema:
{
  "status": "CORRECT" | "MISCONCEPTION" | "INCORRECT",
  "is_correct": boolean,
  "score": number,
  "feedback": "string",
  "understood_concepts": ["concept1"],
  "missing_concepts": ["concept2"],
  "misconceptions": ["misconception1"],
  "retry_question": "string or null",
  "can_advance": boolean,
  "needs_review": boolean
}
"""
            # Format attempt history if available
            history_text = ""
            if attempt_history:
                lines = []
                for a in attempt_history:
                    att_num = getattr(a, "attempt_number", None) or (a.get("attempt_number") if isinstance(a, dict) else "?")
                    att_ans = getattr(a, "student_answer", None) or (a.get("student_answer") if isinstance(a, dict) else "")
                    att_fb = getattr(a, "feedback", None) or (a.get("feedback") if isinstance(a, dict) else "")
                    att_misc = getattr(a, "misconceptions", None) or (a.get("misconceptions") if isinstance(a, dict) else [])
                    misc_str = ", ".join(att_misc) if att_misc else "none"
                    lines.append(f"- Attempt #{att_num}: \"{att_ans}\" | Feedback: {att_fb} | Misconceptions: {misc_str}")
                if lines:
                    history_text = "\nPrevious Attempts in this Checkpoint:\n" + "\n".join(lines) + "\n"

            user_payload = f"""Topic Context: {segment_summary}
Reference Transcript Excerpt: {segment_transcript[:2000]}
Original Question Prompt: {question_prompt}
Active Question Asked: {active_question}
Expected Core Concept: {expected_concept}
Current Student Attempt #{attempt_count}: {cleaned_answer}
{history_text}
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
                    is_corr = bool(data.get("is_correct", False))
                    raw_score = int(data.get("score", 85 if is_corr else 40))
                    clamped_score = max(0, min(100, raw_score))

                    # Strict 3-attempt ceiling enforcement
                    can_adv = is_corr or is_final_attempt
                    needs_rev = (not is_corr) and is_final_attempt
                    retry_q = None if (is_corr or is_final_attempt) else data.get("retry_question")

                    return AnswerEvaluationResponse(
                        status=data.get("status", "CORRECT" if is_corr else "MISCONCEPTION"),
                        is_correct=is_corr,
                        score=clamped_score,
                        feedback=data.get("feedback", "Good explanation! You captured the essential mechanism."),
                        understood_concepts=list(data.get("understood_concepts", []) or []),
                        missing_concepts=list(data.get("missing_concepts", []) or []),
                        misconceptions=list(data.get("misconceptions", []) or []),
                        retry_question=retry_q,
                        can_advance=can_adv,
                        needs_review=needs_rev,
                        follow_up_prompt=retry_q
                    )
                except Exception as model_err:
                    print(f"[EvaluatorService] Model {model_name} evaluation failed: {model_err}")
                    continue

        except Exception as e:
            print(f"[EvaluatorService] All Gemini calls failed ({e}). Falling back to heuristic evaluation.")

        # 2. Intelligent heuristic fallback evaluation
        raw_word_count = len(cleaned_answer.split())
        words = re.findall(r'\b[a-zA-Z]{3,}\b', cleaned_answer.lower())
        
        stopwords = {
            "the", "and", "that", "this", "with", "from", "for", "are", "have",
            "been", "was", "were", "what", "which", "there", "their", "they",
            "can", "will", "would", "about", "into", "also", "some", "like"
        }
        user_keywords = set(w for w in words if w not in stopwords)

        # Context vocabulary from summary, question, expected concepts, and transcript
        context_blob = f"{segment_summary} {expected_concept} {question_prompt} {segment_transcript}".lower()
        context_keywords = set(re.findall(r'\b[a-zA-Z]{3,}\b', context_blob)) - stopwords

        overlap = user_keywords & context_keywords
        # Stem matching (first 4 chars) to catch variations like added/addition, scaled/scaling, close/closed
        stem_matches = set()
        for uk in user_keywords:
            if len(uk) >= 4:
                prefix = uk[:4]
                if any(ck.startswith(prefix) for ck in context_keywords):
                    stem_matches.add(uk)
        effective_overlap = overlap | stem_matches

        # Substantive explanation check:
        # User provides a thoughtful explanation with domain concept overlap
        is_substantive = raw_word_count >= 7 and (len(effective_overlap) >= 2 or any(
            k in cleaned_answer.lower()
            for k in ["force", "oppose", "motion", "resist", "friction", "surface", "rub", "move", "speed", "energy", "contact", "vector", "closed", "scale"]
        ))

        if is_substantive:
            matched_preview = ", ".join(list(overlap)[:3]) if overlap else "the underlying principles"
            return AnswerEvaluationResponse(
                status="CORRECT",
                is_correct=True,
                score=min(100, 80 + len(overlap) * 5),
                feedback=f"Excellent explanation! You clearly grasped the core mechanism: you connected {matched_preview} and explained how the interaction occurs.",
                understood_concepts=list(overlap) if overlap else ["Underlying physical mechanism"],
                missing_concepts=[],
                misconceptions=[],
                retry_question=None,
                can_advance=True,
                needs_review=False,
                follow_up_prompt=None
            )
        else:
            # Not substantive: check if final attempt ceiling reached
            if is_final_attempt:
                matched_list = list(overlap)[:2] if overlap else []
                return AnswerEvaluationResponse(
                    status="MISCONCEPTION",
                    is_correct=False,
                    score=max(20, min(50, len(overlap) * 15)),
                    feedback="Checkpoint complete. You've used all 3 attempts on this question. This topic is flagged as 'Needs Review' so you can continue learning and revisit it later.",
                    understood_concepts=matched_list if matched_list else ["Basic term recognition"],
                    missing_concepts=[expected_concept],
                    misconceptions=["Incomplete explanation of core mechanism"],
                    retry_question=None,
                    can_advance=True,
                    needs_review=True,
                    follow_up_prompt=None
                )
            else:
                retry_prompt = (
                    "Let's narrow down: what specific interaction or force occurs between the surfaces to cause this effect?"
                    if attempt_count == 2
                    else "What specific interaction or force occurs between the surfaces to cause this?"
                )
                return AnswerEvaluationResponse(
                    status="MISCONCEPTION",
                    is_correct=False,
                    score=max(15, min(60, len(overlap) * 15)),
                    feedback="You're on the right track, but try explaining the physical cause more specifically: what happens at the surface or contact point to cause this effect?",
                    understood_concepts=list(overlap)[:2] if overlap else [],
                    missing_concepts=[expected_concept],
                    misconceptions=["Surface interaction not fully articulated"],
                    retry_question=retry_prompt,
                    can_advance=False,
                    needs_review=False,
                    follow_up_prompt=retry_prompt
                )

evaluator_service = EvaluatorService()
