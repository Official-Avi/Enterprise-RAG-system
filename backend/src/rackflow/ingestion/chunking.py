"""Token-budgeted chunking with overlap (FR-019). Pure functions; no I/O.

Paragraphs are the packing unit; oversized paragraphs fall back to sentences, then word windows.
Fenced code blocks are kept whole unless a single block exceeds the budget. Each chunk records
page span and character offsets into the page-joined document text (pages joined by "\\n\\n").
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterator
from dataclasses import dataclass

from rackflow.providers.interfaces import Tokenizer

PAGE_SEPARATOR = "\n\n"
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'(\[])")


@dataclass(slots=True)
class _Segment:
    text: str
    page: int
    start: int
    end: int
    tokens: int


@dataclass(slots=True)
class TextChunk:
    index: int
    text: str
    token_count: int
    page_start: int
    page_end: int
    char_start: int
    char_end: int

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.text.encode("utf-8")).hexdigest()


def _paragraphs(text: str) -> Iterator[tuple[int, int]]:
    """Yield (start, end) offsets of paragraphs; fenced code blocks stay intact."""
    pos = 0
    start: int | None = None
    in_fence = False
    for line in text.split("\n"):
        line_end = pos + len(line)
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
        if not line.strip() and not in_fence:
            if start is not None:
                yield start, pos - 1
                start = None
        elif start is None:
            start = pos
        pos = line_end + 1
    if start is not None:
        yield start, len(text)


def _split_oversized(seg: _Segment, tokenizer: Tokenizer, max_tokens: int) -> list[_Segment]:
    pieces: list[str] = [s for s in _SENTENCE_END.split(seg.text) if s.strip()]
    out: list[str] = []
    for piece in pieces:
        if tokenizer.count(piece) <= max_tokens:
            out.append(piece)
            continue
        words = piece.split()
        window: list[str] = []
        for word in words:
            if window and tokenizer.count(" ".join([*window, word])) > max_tokens:
                out.append(" ".join(window))
                window = []
            window.append(word)
        if window:
            out.append(" ".join(window))
    # Re-pack small sentences so pieces are close to the budget.
    packed: list[str] = []
    for piece in out:
        if packed and tokenizer.count(packed[-1] + " " + piece) <= max_tokens:
            packed[-1] = packed[-1] + " " + piece
        else:
            packed.append(piece)
    segments: list[_Segment] = []
    cursor = seg.start
    for piece in packed:
        first_word = piece.split()[0] if piece.split() else piece
        found = seg.text.find(first_word, cursor - seg.start)
        start = seg.start + (found if found >= 0 else cursor - seg.start)
        segments.append(_Segment(piece, seg.page, start, min(seg.end, start + len(piece)),
                                 tokenizer.count(piece)))
        cursor = segments[-1].end
    return segments


def _segments(pages: list[tuple[int, str]], tokenizer: Tokenizer,
              max_tokens: int) -> list[_Segment]:
    segments: list[_Segment] = []
    offset = 0
    for page_no, text in pages:
        for start, end in _paragraphs(text):
            para = text[start:end].strip()
            if not para:
                continue
            seg = _Segment(para, page_no, offset + start, offset + end, tokenizer.count(para))
            if seg.tokens > max_tokens:
                segments.extend(_split_oversized(seg, tokenizer, max_tokens))
            else:
                segments.append(seg)
        offset += len(text) + len(PAGE_SEPARATOR)
    return segments


def _tail_sentences(seg: _Segment, tokenizer: Tokenizer, budget: int) -> _Segment | None:
    """Trailing sentences of a segment that fit in the overlap budget (overlap for long
    paragraphs, which would otherwise carry nothing into the next chunk)."""
    sentences = [s for s in _SENTENCE_END.split(seg.text) if s.strip()]
    picked: list[str] = []
    for sentence in reversed(sentences[1:]):  # never carry the whole paragraph
        candidate = " ".join([sentence, *picked])
        if tokenizer.count(candidate) > budget:
            break
        picked.insert(0, sentence)
    if not picked:
        return None
    text = " ".join(picked)
    return _Segment(text, seg.page, max(seg.start, seg.end - len(text)), seg.end,
                    tokenizer.count(text))


def chunk_pages(
    pages: list[tuple[int, str]],
    tokenizer: Tokenizer,
    *,
    chunk_size: int,
    overlap: int,
) -> list[TextChunk]:
    if chunk_size <= 0 or overlap < 0 or overlap >= chunk_size:
        raise ValueError("require 0 <= overlap < chunk_size")
    segments = _segments(pages, tokenizer, chunk_size)
    chunks: list[TextChunk] = []
    current: list[_Segment] = []
    current_tokens = 0

    def emit() -> None:
        text = "\n\n".join(s.text for s in current)
        chunks.append(TextChunk(
            index=len(chunks), text=text, token_count=tokenizer.count(text),
            page_start=min(s.page for s in current), page_end=max(s.page for s in current),
            char_start=current[0].start, char_end=current[-1].end,
        ))

    for seg in segments:
        if current and current_tokens + seg.tokens > chunk_size:
            emit()
            carry: list[_Segment] = []
            carried = 0
            for prev in reversed(current):
                if carried + prev.tokens > overlap:
                    break
                carry.insert(0, prev)
                carried += prev.tokens
            if not carry and overlap > 0:
                tail = _tail_sentences(current[-1], tokenizer, overlap)
                if tail is not None:
                    carry, carried = [tail], tail.tokens
            current, current_tokens = carry, carried
            if current_tokens + seg.tokens > chunk_size:
                current, current_tokens = [], 0
        current.append(seg)
        current_tokens += seg.tokens
    if current:
        emit()
    return chunks
