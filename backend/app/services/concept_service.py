"""Concept label normalisation so the same idea maps to one stable key."""
import re
import unicodedata
from typing import Iterable, List, Tuple

MAX_KEY_LEN = 200
MAX_LABEL_LEN = 300
_ARTICLES = {"a", "an", "the"}
_PUNCT = re.compile(r"[^\w\s]|_", re.UNICODE)
_SPACE = re.compile(r"\s+")


def _stem(word: str) -> str:
    """Light plural stemming only (so 'matrices'/'matrix' differences stay distinct but 'vectors'/'vector' match)."""
    if len(word) <= 3 or not word.isalpha():
        return word
    if word.endswith("ies") and len(word) > 4:
        return word[:-3] + "y"
    if word.endswith(("sses", "xes")):
        return word[:-2]
    if word.endswith(("ss", "us", "is")):
        return word
    if word.endswith("s"):
        return word[:-1]
    return word


def normalise_concept(label: str) -> str:
    """Lowercase, strip punctuation and articles, collapse whitespace, lightly stem."""
    if not isinstance(label, str):
        return ""
    text = unicodedata.normalize("NFKC", label).lower()
    text = _PUNCT.sub(" ", text)
    words = [w for w in _SPACE.split(text.strip()) if w and w not in _ARTICLES]
    return " ".join(_stem(w) for w in words)[:MAX_KEY_LEN].strip()


def dedupe_concepts(labels: Iterable[str]) -> List[Tuple[str, str]]:
    """Return [(key, label)] in first-seen order, one entry per distinct non-empty key."""
    seen = set()
    out: List[Tuple[str, str]] = []
    for raw in labels:
        if not isinstance(raw, str):
            continue
        label = _SPACE.sub(" ", raw).strip()[:MAX_LABEL_LEN]
        key = normalise_concept(label)
        if key and key not in seen:
            seen.add(key)
            out.append((key, label))
    return out
