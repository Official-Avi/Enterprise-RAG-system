"""Citation marker formats that real OpenAI-compatible models produce."""

import uuid

import pytest

from rackflow.providers.chat import ExtractiveProvider
from rackflow.providers.interfaces import ChatTurn
from rackflow.rag.answer import UNVERIFIED_MESSAGE, interpret_reply, refusal_text, verify_citations
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


CV = [_chunk("Proficient in Python, FastAPI and PostgreSQL. Backend developer intern in 2024.",
              "cv.pdf")]


def test_cited_refusal_is_shown_as_a_partial_answer() -> None:
    """2026-11-18: "is he eligible for python developer role?" on a CV was hidden as a refusal
    although the model listed the CV's Python skills with a citation."""
    answer, status, citations = interpret_reply(
        "INSUFFICIENT_EVIDENCE: The CV lists Python and FastAPI [1], "
        "but no job criteria are given.",
        CV)
    assert status == "supported" and [c.marker for c in citations] == [1]
    assert answer.startswith("The CV lists Python") and "INSUFFICIENT" not in answer


@pytest.mark.parametrize("reply", [
    "INSUFFICIENT_EVIDENCE: The CV says nothing about salary.",
    "INSUFFICIENT_EVIDENCE: Source [7] is not relevant.",  # a marker outside the sources
])
def test_refusal_without_a_real_citation_stays_a_refusal(reply: str) -> None:
    answer, status, citations = interpret_reply(reply, CV)
    assert status == "insufficient" and citations == []
    assert answer.startswith("The available sources don't contain enough information")


@pytest.mark.parametrize("reply", [
    "The provided resume documents [1] do not contain any information regarding salary.",
    "There is no mention of salary in the CV [1].",
    "The CV does not mention salary.\n[1]",
])
def test_citing_a_source_only_to_say_it_lacks_something_is_a_refusal(reply: str) -> None:
    """2026-11-18: "What is his salary expectation?" came back as a supported answer whose only
    citations were attached to "the documents do not contain any information"."""
    answer, status, citations = interpret_reply(reply, CV)
    assert status == "insufficient" and citations == []
    assert answer.startswith("The available sources don't contain enough information")
    assert "[1]" not in answer


def test_facts_plus_a_missing_criterion_stay_supported() -> None:
    reply = ("The sources do not contain the job criteria.\n"
             "* He is proficient in Python and FastAPI [1].\n"
             "To decide, the role's requirements are needed.")
    _, status, citations = interpret_reply(reply, CV)
    assert status == "supported" and len(citations) == 1


def test_uncited_answer_is_not_shown() -> None:
    expected = (UNVERIFIED_MESSAGE, "insufficient", [])
    assert interpret_reply("He is clearly eligible.", CV) == expected


def test_prompt_sets_no_formatting_rule() -> None:
    """A "plain text only, no Markdown" rule made the live model (Groq, qwen/qwen3.8-27b) abstain on
    6 of 11 answerable questions on 2026-11-06. The client handles bold and headings instead
    (AnswerBlock.tsx)."""
    assert "Markdown" not in SYSTEM_PROMPT and "plain text" not in SYSTEM_PROMPT
