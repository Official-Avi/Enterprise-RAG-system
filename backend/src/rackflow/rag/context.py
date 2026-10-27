"""Bounded context assembly with numbered, delimited, untrusted sources."""

from __future__ import annotations

from rackflow.providers.tokenizer import get_tokenizer
from rackflow.rag.retrieval import RetrievedChunk

SAFETY_MARGIN = 0.85  # token counts are estimates (providers/tokenizer.py)


def _neutralise(text: str) -> str:
    """Prevent document text from closing or opening our delimiter tags."""
    return text.replace("</source", "<\\/source").replace("<source", "<\\source") \
        .replace("</sources", "<\\/sources")


def _pages(c: RetrievedChunk) -> str:
    if c.page_start is None:
        return "n/a"
    return str(c.page_start) if c.page_start == c.page_end else f"{c.page_start}-{c.page_end}"


def build_context(chunks: list[RetrievedChunk], question: str,
                  *, budget_tokens: int) -> tuple[str, list[RetrievedChunk]]:
    """Return (user prompt, sources actually included, in [1..n] order)."""
    tokenizer = get_tokenizer()
    budget = int(budget_tokens * SAFETY_MARGIN)
    used: list[RetrievedChunk] = []
    blocks: list[str] = []
    spent = tokenizer.count(question) + 60
    for chunk in chunks:
        filename = _neutralise(chunk.filename).replace('"', "'")
        block = (f'<source id="{len(used) + 1}" document="{filename}" pages="{_pages(chunk)}">\n'
                 f"{_neutralise(chunk.text)}\n</source>")
        cost = tokenizer.count(block)
        if used and spent + cost > budget:
            break
        used.append(chunk)
        blocks.append(block)
        spent += cost
    prompt = ("Answer the question using only the sources below.\n\n<sources>\n"
              + "\n".join(blocks) + "\n</sources>\n\nQuestion: " + question.strip())
    return prompt, used
