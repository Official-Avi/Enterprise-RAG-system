"""Grounded answer generation: retrieve → bounded context → model → verified citations."""

from __future__ import annotations

import re
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.auth.principal import Principal
from rackflow.core.logging import get_correlation_id
from rackflow.db.models import ChatMessage, ModelRequestLog
from rackflow.db.session import session_scope
from rackflow.providers.chat import ModelError, get_chat_provider
from rackflow.providers.interfaces import ChatTurn
from rackflow.rag.context import build_context
from rackflow.rag.evidence import (
    MAX_HISTORY_LOOKBACK,
    followup_context,
    parse_passage,
    terms,
)
from rackflow.rag.injection import looks_like_injection
from rackflow.rag.prompts import (
    FULLWIDTH_MARKER_RE,
    INSUFFICIENT_MARKER,
    MARKER_RE,
    SYSTEM_PROMPT,
)
from rackflow.rag.retrieval import RetrievedChunk, retrieve
from rackflow.rag.smalltalk import small_talk_reply
from rackflow.tenant_settings import effective_settings

CONTEXT_BUDGET_TOKENS = 6000
ANSWER_MAX_TOKENS = 16000
QUOTE_CHARS = 300
_MARKER_RUN_RE = re.compile(r"(?:\s*\[\d{1,3}\])+")
MIN_QUOTE_CHARS = 15

NO_SOURCES_MESSAGE = ("I couldn't find passages in the selected collections that answer this "
                      "question. Try rephrasing, or check that the relevant documents are indexed "
                      "and that you have access to them.")
UNVERIFIED_MESSAGE = ("I couldn't produce an answer that is verifiably supported by the "
                      "retrieved sources.")


@dataclass(slots=True)
class CitationResult:
    marker: int
    chunk: RetrievedChunk
    quote: str


@dataclass(slots=True)
class AnswerResult:
    answer: str
    evidence_status: Literal["supported", "insufficient", "conversational"]
    citations: list[CitationResult] = field(default_factory=list)
    provider: str = ""
    model: str = ""
    deployment_mode: str = ""
    latency_ms: int = 0
    retrieved_count: int = 0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    sources: list[RetrievedChunk] = field(default_factory=list)  # what the model was given


def _trim(text: str) -> str:
    if len(text) <= QUOTE_CHARS:
        return text
    return text[: QUOTE_CHARS - 1].rsplit(" ", 1)[0].rstrip() + "…"


def _best_sentence(sentences: list[str], claim: str) -> tuple[str, int]:
    """The sentence sharing most terms with the claim, and how many; a verbatim one wins."""
    flat_claim = " ".join(claim.split()).lower()
    claim_terms = terms(claim)
    best, best_score = sentences[0], 0
    for sentence in sentences:
        if sentence.lower() in flat_claim:
            return sentence, len(terms(sentence)) + 1
        score = len(claim_terms & terms(sentence))
        if score > best_score:
            best, best_score = sentence, score
    return best, best_score


def _quote(chunk: RetrievedChunk, claim: str, answer: str) -> str:
    """The chunk sentence that best supports what the answer says from this source.

    Whole sentences, whatever the line wrapping, and never text flagged as an instruction. "[1]
    says that..." and "According to [1], ..." put nothing useful in front of the marker, so a claim
    that matches no sentence falls back to the whole answer.
    """
    sentences = [s.text for s in parse_passage(chunk.text).sentences
                 if len(s.text) >= MIN_QUOTE_CHARS]
    if not sentences:
        return "" if looks_like_injection(chunk.text) else _trim(" ".join(chunk.text.split()))
    best, score = _best_sentence(sentences, claim)
    if not score:
        best, _ = _best_sentence(sentences, answer)
    return _trim(best)


def _claims_by_marker(text: str) -> dict[int, str]:
    """What the answer says from each source: the text in front of that source's markers.

    "To fix it, follow these steps [1]:" puts the facts after the marker, so a marker followed by
    a colon also claims the text up to the next marker; otherwise its quote is picked from the
    lead-in alone and lands on the symptom, not the fix.
    """
    claims: dict[int, list[str]] = {}
    runs = list(_MARKER_RUN_RE.finditer(text))
    position = 0
    for i, run in enumerate(runs):
        before = text[position:run.start()]
        position = run.end()
        if text[run.end():].lstrip(" \t").startswith(":"):
            end = runs[i + 1].start() if i + 1 < len(runs) else len(text)
            before += " " + text[run.end():end]
        for raw in MARKER_RE.findall(run.group(0)):
            claims.setdefault(int(raw), []).append(before)
    return {marker: " ".join(parts) for marker, parts in claims.items()}


def _log_model_call(tenant_id: uuid.UUID, provider: str, model: str, status: str,
                    latency_ms: int, prompt_tokens: int | None = None,
                    completion_tokens: int | None = None, error_code: str | None = None) -> None:
    with session_scope() as s:  # separate transaction: metrics survive request failures
        s.add(ModelRequestLog(tenant_id=tenant_id, provider=provider, model_name=model,
                              purpose="chat", status=status, latency_ms=latency_ms,
                              prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                              error_code=error_code, correlation_id=get_correlation_id()))


def verify_citations(text: str, sources: list[RetrievedChunk]) -> tuple[str, list[CitationResult]]:
    """Keep only markers that refer to sources actually given to the model; strip the rest.

    Markers are renumbered 1..n in order of appearance, so they count this answer's own sources
    and not the retrieved passages, of which the reader never sees the unused ones.
    """
    text = FULLWIDTH_MARKER_RE.sub(r"[\1]", text)
    renumbered: dict[int, int] = {}
    for raw in MARKER_RE.findall(text):
        n = int(raw)
        if 1 <= n <= len(sources) and n not in renumbered:
            renumbered[n] = len(renumbered) + 1

    def rewrite(match: re.Match[str]) -> str:
        new = renumbered.get(int(match.group(1)))
        return f"[{new}]" if new else ""

    cleaned = re.sub(r"[ \t]{2,}", " ", MARKER_RE.sub(rewrite, text)).strip()
    claims = _claims_by_marker(cleaned)
    return cleaned, [CitationResult(marker=new, chunk=sources[old - 1],
                                    quote=_quote(sources[old - 1], claims.get(new, ""), cleaned))
                     for old, new in renumbered.items()]


def refusal_text(reply: str) -> str:
    """What the reader sees for an INSUFFICIENT_EVIDENCE reply. A refusal has no citations, so any
    marker the model left in its explanation would point at nothing and is removed."""
    explanation = FULLWIDTH_MARKER_RE.sub("", reply[len(INSUFFICIENT_MARKER):])
    # "[ \t]*" too: "by the platform team [3]." must not become "by the platform team ."
    explanation = re.sub(r"[ \t]*" + MARKER_RE.pattern, "", explanation)
    explanation = re.sub(r"[ \t]{2,}", " ", explanation).strip()
    return ("The available sources don't contain enough information to answer this."
            + (f" {explanation}" if explanation else ""))


def interpret_reply(reply: str, sources: list[RetrievedChunk]
                    ) -> tuple[str, Literal["supported", "insufficient"], list[CitationResult]]:
    """The answer the reader sees, its evidence status and its verified citations.

    A refusal that still cites real sources is a partial answer ("the CV lists Python [1], but no
    job criteria are given"), so it is shown with its citations instead of hiding the facts. A
    refusal with no verifiable citation stays a refusal.
    """
    text = reply.strip()
    refused = text.upper().startswith(INSUFFICIENT_MARKER)
    body = text[len(INSUFFICIENT_MARKER):].strip() if refused else text
    cleaned, citations = verify_citations(body, sources)
    if citations and cleaned and not _only_cites_absence(cleaned):
        return cleaned, "supported", citations
    if refused or (citations and cleaned):
        # Either a plain refusal, or "the documents [1][2] don't mention salary": citing a source
        # to say what it lacks is still a refusal.
        return refusal_text(f"{INSUFFICIENT_MARKER} {body}"), "insufficient", []
    return UNVERIFIED_MESSAGE, "insufficient", []


_ABSENCE_RE = re.compile(
    r"\b(?:do|does|did)(?: not|n't) (?:contain|mention|include|say|state|specify|provide|"
    r"list|cover|address|discuss|describe|give)\b"
    r"|\bno (?:information|mention|details?|data|reference)\b"
    r"|\bnot (?:mentioned|specified|stated|provided|included|listed|available|given)\b",
    re.IGNORECASE)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_MARKERS_ONLY_RE = re.compile(r"^(?:\[\d{1,3}\]\s*)+[.!?]?$")


def _only_cites_absence(answer: str) -> bool:
    """True when every sentence that carries a citation only says something is missing."""
    sentences: list[str] = []
    for part in _SENTENCE_SPLIT_RE.split(answer):
        part = part.strip()
        if sentences and _MARKERS_ONLY_RE.match(part):
            sentences[-1] += " " + part  # "...expectations. [1]" belongs to the sentence before
        elif part:
            sentences.append(part)
    cited = [s for s in sentences if MARKER_RE.search(s)]
    return bool(cited) and all(_ABSENCE_RE.search(s) for s in cited)


def prior_user_turns(db: Session, tenant_id: uuid.UUID, conversation_id: uuid.UUID) -> list[str]:
    """The conversation's latest user questions, oldest first. Call before storing the new one."""
    rows = db.scalars(
        select(ChatMessage.content)
        .where(ChatMessage.tenant_id == tenant_id, ChatMessage.conversation_id == conversation_id,
               ChatMessage.role == "user")
        .order_by(ChatMessage.created_at.desc())
        .limit(MAX_HISTORY_LOOKBACK)
    ).all()
    # A greeting or "thanks" is not context for the next question.
    return [q for q in reversed(rows) if small_talk_reply(q) is None]


def answer_question(db: Session, principal: Principal, question: str,
                    collection_ids: list[uuid.UUID] | None,
                    history: Sequence[str] = ()) -> AnswerResult:
    """`history` is the conversation's earlier user turns, oldest first (`prior_user_turns`). It
    only shapes the search text; which documents the caller may see is decided in `retrieve`."""
    started = time.perf_counter()
    settings = effective_settings(db, principal.tenant_id)
    provider = get_chat_provider()

    reply = small_talk_reply(question)
    if reply is not None:  # "hi", "thanks", "what can you do": no search, no model call
        return AnswerResult(answer=reply, evidence_status="conversational",
                            latency_ms=int((time.perf_counter() - started) * 1000),
                            provider=provider.provider, model=provider.model,
                            deployment_mode=provider.deployment_mode)

    context = followup_context(question, history)
    query = f"{context} {question}" if context else question
    chunks = retrieve(db, principal, query, collection_ids, top_k=settings.retrieval_top_k,
                      score_threshold=settings.retrieval_score_threshold)
    if not chunks:
        return AnswerResult(answer=NO_SOURCES_MESSAGE, evidence_status="insufficient",
                            latency_ms=int((time.perf_counter() - started) * 1000),
                            provider=provider.provider, model=provider.model,
                            deployment_mode=provider.deployment_mode)

    prompt, sources = build_context(chunks, question, budget_tokens=CONTEXT_BUDGET_TOKENS,
                                    context=context)
    try:
        completion = provider.complete(system=SYSTEM_PROMPT, turns=[ChatTurn("user", prompt)],
                                       max_tokens=ANSWER_MAX_TOKENS, temperature=0.0)
    except ModelError as exc:
        _log_model_call(principal.tenant_id, provider.provider, provider.model,
                        "timeout" if exc.code == "MODEL_TIMEOUT" else "error",
                        int((time.perf_counter() - started) * 1000), error_code=exc.code)
        raise
    _log_model_call(principal.tenant_id, completion.provider, completion.model, "ok",
                    completion.latency_ms, completion.prompt_tokens, completion.completion_tokens)

    result = AnswerResult(
        answer="", evidence_status="insufficient", provider=completion.provider,
        model=completion.model, deployment_mode=provider.deployment_mode,
        retrieved_count=len(sources), sources=sources, prompt_tokens=completion.prompt_tokens,
        completion_tokens=completion.completion_tokens,
    )
    result.answer, result.evidence_status, result.citations = interpret_reply(completion.text,
                                                                             sources)
    result.latency_ms = int((time.perf_counter() - started) * 1000)
    return result
