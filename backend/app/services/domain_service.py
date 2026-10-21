import logging
from typing import Optional

from google import genai
from google.genai import types

from app.core.config import settings
from app.services._model_race import race_candidates

logger = logging.getLogger(__name__)

DOMAINS = [
    "Computer Science",
    "Mathematics",
    "Physics",
    "Biology",
    "Chemistry",
    "Economics & Finance",
    "Humanities",
    "Other",
]
DEFAULT_DOMAIN = "Other"


def match_domain(text: Optional[str]) -> Optional[str]:
    """Map free text onto the fixed taxonomy (exact, case-insensitive); None if no match."""
    if not text:
        return None
    cleaned = text.strip().strip('"\'`.').lower()
    for d in DOMAINS:
        if cleaned == d.lower():
            return d
    return None


def classify_domain(title: str, transcript_excerpt: str, api_key: str = "") -> str:
    """Classify a lecture into one taxonomy value via Gemini. Any failure -> "Other"."""
    key = api_key.strip() if api_key else settings.google_api_key
    if not key:
        return DEFAULT_DOMAIN
    try:
        client = genai.Client(api_key=key)
        prompt = (
            "Classify this lecture into exactly one subject domain from this list: "
            + ", ".join(DOMAINS)
            + ".\nAnswer with the domain name only.\n\n"
            f"Title: {(title or '')[:300]}\n"
            f"Transcript excerpt: {(transcript_excerpt or '')[:1500]}"
        )
        # Cheapest models first: this is a one-word classification.
        order = sorted(settings.gemini_candidate_models, key=lambda m: 0 if "lite" in m else 1)

        def _attempt(model_name: str) -> str:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(temperature=0),
            )
            domain = match_domain(response.text)
            if domain is None:
                raise ValueError("Response not in taxonomy")
            return domain

        return race_candidates(order, _attempt, max_parallel=2, server_key=not (api_key or "").strip()) or DEFAULT_DOMAIN
    except Exception as e:
        logger.warning(f"[DomainService] Classification failed ({type(e).__name__}); using default")
        return DEFAULT_DOMAIN
