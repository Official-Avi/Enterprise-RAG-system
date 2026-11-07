"""Citation marker formats that real OpenAI-compatible models produce."""

import uuid

import pytest

from rackflow.providers.chat import ExtractiveProvider
from rackflow.providers.interfaces import ChatTurn
from rackflow.rag.answer import refusal_text, verify_citations
from rackflow.rag.context import build_context
from rackflow.rag.prompts import SYSTEM_PROMPT
from rackflow.rag.retrieval import RetrievedChunk


def _chunk(text: str, name: str) -> RetrievedChunk:
    return RetrievedChunk(chunk_id=uuid.uuid4(), document_id=uuid.uuid4(),
                          collection_id=uuid.uuid4(), filename=name, page_start=None,
                          page_end=None, score=0.9, text=text)


SOURCES = [_chunk("Nightly backups are retained for 45 days in the vault.", "policy.txt")]


@pytest.mark.parametrize("reply", [
    "Backups are retained for **45 days** [1].",
    "Backups are retained for **45 days**【1】.",
    "Backups are retained for **45 days**【1†L1-L2】.",
])
def test_supported_marker_styles_become_verified_citations(reply: str) -> None:
    cleaned, citations = verify_citations(reply, SOURCES)
    assert [c.marker for c in citations] == [1]
    assert "[1]" in cleaned
    assert "【" not in cleaned


def test_fullwidth_marker_outside_the_sources_is_still_rejected() -> None:
    cleaned, citations = verify_citations("Backups last 45 days【9】.", SOURCES)
    assert citations == []
    assert "【" not in cleaned
    assert "[9]" not in cleaned


@pytest.mark.parametrize("reference", ["[2]", "【2】", "【2†L1-L2】"])
def test_document_text_cannot_cite_another_source(reference: str) -> None:
    """A reference in a document's own sentence used to be read as a citation of source 2, which
    credited the claim to that document."""
    sources = [
        _chunk(f"The relief valve is safe to 900 bar as required by {reference}.", "one.txt"),
        _chunk("The cafeteria opens at noon every weekday.", "two.txt"),
    ]
    prompt, used = build_context(sources, "What pressure is the relief valve safe to?",
                                 budget_tokens=2000)
    assert reference not in prompt
    out = ExtractiveProvider().complete(system="", turns=[ChatTurn("user", prompt)],
                                        max_tokens=100, temperature=0)
    answer, citations = verify_citations(out.text, used)
    assert [c.chunk.filename for c in citations] == ["one.txt"]
    assert "900 bar" in answer and answer.endswith("[1]") and answer.count("[1]") == 1
    assert "(2)" in answer


def test_quote_is_found_when_the_marker_opens_the_answer() -> None:
    source = _chunk("Scope of this policy covers all storage systems. Nightly backups are "
                    "retained for 45 days in the vault.", "policy.txt")
    for reply in ("[1] states that backups are retained for 45 days.",
                  "According to [1], backups are retained for 45 days."):
        _, citations = verify_citations(reply, [source])
        assert "45 days" in citations[0].quote, reply


def test_refusal_text_shows_no_markers() -> None:
    answer = refusal_text("INSUFFICIENT_EVIDENCE: [1] and 【2†L1-L2】 do not name the owner.")
    assert answer.endswith("and do not name the owner.")
    assert "[" not in answer and "【" not in answer


def test_prompt_sets_no_formatting_rule() -> None:
    """A "plain text only, no Markdown" rule made the live model (Groq, qwen/qwen3.8-27b) abstain on
    6 of 11 answerable questions on 2026-11-06. The client handles bold and headings instead
    (AnswerBlock.tsx)."""
    assert "Markdown" not in SYSTEM_PROMPT and "plain text" not in SYSTEM_PROMPT
