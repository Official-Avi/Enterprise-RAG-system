"""Heuristic detection of instruction-like text aimed at AI systems inside documents (FR-036).

Detection is defence in depth, not a guarantee: retrieved text is always treated as untrusted
data. Flagged text is never quoted by the extractive provider, is marked in the model prompt,
and produces a document warning at ingestion so operators can review the source.
"""

from __future__ import annotations

import re

_PATTERNS = [
    r"\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all)\b"
    r"[^.\n]{0,20}\b(instructions?|prompts?|rules)\b",
    r"\b(system|developer|admin(istrator)?)\s+(prompt|message|notice|instruction)s?\b"
    r"[^.\n]{0,40}\b(ai|assistant|model|llm|chatbot)s?\b",
    r"\b(note|notice|message|instructions?)\s+(to|for)\s+(the\s+)?(ai|assistant|model|llm|chatbot)s?\b",
    r"\byou are now\b",
    r"\b(reply|respond|answer)\s+only\s+with\b",
    r"\b(reveal|print|show|output|leak)\b[^.\n]{0,30}\b(system prompt|instructions|"
    r"confidential|secret|password|api key)s?\b",
]
_RE = re.compile("|".join(f"(?:{p})" for p in _PATTERNS), re.IGNORECASE)


def looks_like_injection(text: str) -> bool:
    return bool(_RE.search(text))
