"""Extraction quality assessment (FR-014, FR-016). Produces a 0..1 score plus warnings."""

from __future__ import annotations

from dataclasses import dataclass, field

MIN_USABLE_ALNUM_CHARS = 20
LOW_QUALITY_SCORE = 0.5


@dataclass(slots=True)
class QualityReport:
    score: float
    usable: bool
    warnings: list[str] = field(default_factory=list)
    total_chars: int = 0
    empty_pages: int = 0


def assess_quality(pages: list[tuple[int, str]]) -> QualityReport:
    text = "\n".join(t for _, t in pages)
    total = len(text)
    empty = sum(1 for _, t in pages if not t.strip())
    non_space = [c for c in text if not c.isspace()]
    alnum = sum(1 for c in non_space if c.isalnum())
    if not non_space:
        return QualityReport(score=0.0, usable=False, warnings=["No extractable text was found"],
                             total_chars=total, empty_pages=empty)

    printable_ratio = sum(1 for c in non_space if c.isprintable()) / len(non_space)
    alnum_ratio = alnum / len(non_space)
    words = text.split()
    avg_word = sum(len(w) for w in words) / max(1, len(words))
    word_score = 1.0 if 2.0 <= avg_word <= 12.0 else 0.4
    page_score = 1.0 - (empty / max(1, len(pages)))
    score = round(0.35 * printable_ratio + 0.35 * min(1.0, alnum_ratio / 0.7)
                  + 0.15 * word_score + 0.15 * page_score, 3)

    warnings: list[str] = []
    if empty:
        warnings.append(f"{empty} of {len(pages)} page(s) contain no text")
    if score < LOW_QUALITY_SCORE:
        warnings.append(
            "Extracted text quality is low; answers from this document may be unreliable"
        )
    return QualityReport(score=score, usable=alnum >= MIN_USABLE_ALNUM_CHARS, warnings=warnings,
                         total_chars=total, empty_pages=empty)
