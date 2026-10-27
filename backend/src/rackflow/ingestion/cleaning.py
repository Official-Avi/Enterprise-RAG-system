"""Conservative text cleaning (FR-017): normalise, de-hyphenate, drop repeated page furniture.
Code fences, tables and punctuation are preserved; page boundaries are kept."""

from __future__ import annotations

import re
import unicodedata
from collections import Counter

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_HYPHEN_BREAK = re.compile(r"([a-z])-\n([a-z])")
_MULTI_SPACE = re.compile(r"[ \t ]{2,}")
_MANY_BLANKS = re.compile(r"\n{3,}")
_DIGITS = re.compile(r"\d+")


def _clean_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", text)
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    out: list[str] = []
    in_fence = False
    for line in text.split("\n"):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            out.append(line.rstrip())
            continue
        out.append(line.rstrip() if in_fence else _MULTI_SPACE.sub(" ", line).strip())
    return _MANY_BLANKS.sub("\n\n", "\n".join(out)).strip()


def _edge_lines(text: str) -> tuple[str | None, str | None]:
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    if not lines:
        return None, None
    return _DIGITS.sub("#", lines[0]), _DIGITS.sub("#", lines[-1])


def _strip_repeated_furniture(pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """Remove a header/footer line that repeats (modulo page numbers) on >=60% of pages."""
    if len(pages) < 3:
        return pages
    firsts: Counter[str] = Counter()
    lasts: Counter[str] = Counter()
    for _, text in pages:
        first, last = _edge_lines(text)
        if first:
            firsts[first] += 1
        if last:
            lasts[last] += 1
    threshold = max(3, int(0.6 * len(pages)))
    headers = {k for k, n in firsts.items() if n >= threshold and len(k) <= 120}
    footers = {k for k, n in lasts.items() if n >= threshold and len(k) <= 120}
    if not headers and not footers:
        return pages
    result: list[tuple[int, str]] = []
    for page_no, text in pages:
        lines = text.split("\n")
        idx = [i for i, ln in enumerate(lines) if ln.strip()]
        drop: set[int] = set()
        if idx and _DIGITS.sub("#", lines[idx[0]].strip()) in headers:
            drop.add(idx[0])
        if idx and _DIGITS.sub("#", lines[idx[-1]].strip()) in footers:
            drop.add(idx[-1])
        kept = "\n".join(ln for i, ln in enumerate(lines) if i not in drop)
        result.append((page_no, kept.strip()))
    return result


def clean_pages(pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    cleaned = [(n, _clean_text(t)) for n, t in pages]
    return _strip_repeated_furniture(cleaned)
