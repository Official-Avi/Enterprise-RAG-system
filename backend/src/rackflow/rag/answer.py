"""Grounded answer generation: retrieve → bounded context → model → verified citations."""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy.orm import Session

from rackflow.auth.principal import Principal
from rackflow.core.logging import get_correlation_id
from rackflow.db.models import ModelRequestLog
from rackflow.db.session import session_scope
from rackflow.providers.chat import ModelError, get_chat_provider
from rackflow.providers.interfaces import ChatTurn
from rackflow.rag.context import build_context
from rackflow.rag.prompts import INSUFFICIENT_MARKER, SYSTEM_PROMPT
from rackflow.rag.retrieval import RetrievedChunk, retrieve
from rackflow.tenant_settings import effective_settings

CONTEXT_BUDGET_TOKENS = 6000
ANSWER_MAX_TOKENS = 16000
QUOTE_CHARS = 300
_MARKER_RE = re.compile(r"\[(\d{1,3})\]")
_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n+")
_WORD_RE = re.compile(r"[a-z0-9_]+")

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
    evidence_status: Literal["supported", "insufficient"]
    citations: list[CitationResult] = field(default_factory=list)
    provider: str = ""
    model: str = ""
    deployment_mode: str = ""
    latency_ms: int = 0
    retrieved_count: int = 0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    sources: list[RetrievedChunk] = field(default_factory=list)  # what the model was given


def _quote(chunk: RetrievedChunk, answer: str) -> str:
    """The chunk sentence most similar to the answer, trimmed to QUOTE_CHARS."""
    answer_terms = set(_WORD_RE.findall(answer.lower()))
    best, best_score = chunk.text[:QUOTE_CHARS], -1
    for sentence in _SENTENCE_RE.split(chunk.text):
        sentence = sentence.strip()
        if len(sentence) < 15:
            continue
        score = len(answer_terms & set(_WORD_RE.findall(sentence.lower())))
        if score > best_score:
            best, best_score = sentence, score
    return best if len(best) <= QUOTE_CHARS else best[: QUOTE_CHARS - 1].rstrip() + "…"


def _log_model_call(tenant_id: uuid.UUID, provider: str, model: str, status: str,
                    latency_ms: int, prompt_tokens: int | None = None,
                    completion_tokens: int | None = None, error_code: str | None = None) -> None:
    with session_scope() as s:  # separate transaction: metrics survive request failures
        s.add(ModelRequestLog(tenant_id=tenant_id, provider=provider, model_name=model,
                              purpose="chat", status=status, latency_ms=latency_ms,
                              prompt_tokens=prompt_tokens, completion_tokens=completion_tokens,
                              error_code=error_code, correlation_id=get_correlation_id()))


def verify_citations(text: str, sources: list[RetrievedChunk]) -> tuple[str, list[CitationResult]]:
    """Keep only markers that refer to sources actually given to the model; strip the rest."""
    valid: dict[int, CitationResult] = {}
    for raw in _MARKER_RE.findall(text):
        n = int(raw)
        if 1 <= n <= len(sources) and n not in valid:
            valid[n] = CitationResult(marker=n, chunk=sources[n - 1], quote="")
    cleaned = _MARKER_RE.sub(lambda m: m.group(0) if int(m.group(1)) in valid else "", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
    for c in valid.values():
        c.quote = _quote(c.chunk, cleaned)
    return cleaned, list(valid.values())


def answer_question(db: Session, principal: Principal, question: str,
                    collection_ids: list[uuid.UUID] | None) -> AnswerResult:
    started = time.perf_counter()
    settings = effective_settings(db, principal.tenant_id)
    provider = get_chat_provider()

    chunks = retrieve(db, principal, question, collection_ids, top_k=settings.retrieval_top_k,
                      score_threshold=settings.retrieval_score_threshold)
    if not chunks:
        return AnswerResult(answer=NO_SOURCES_MESSAGE, evidence_status="insufficient",
                            latency_ms=int((time.perf_counter() - started) * 1000),
                            provider=provider.provider, model=provider.model,
                            deployment_mode=provider.deployment_mode)

    prompt, sources = build_context(chunks, question, budget_tokens=CONTEXT_BUDGET_TOKENS)
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
    text = completion.text.strip()
    if text.upper().startswith(INSUFFICIENT_MARKER):
        explanation = text[len(INSUFFICIENT_MARKER):].strip()
        result.answer = ("The available sources don't contain enough information to answer this."
                         + (f" {explanation}" if explanation else ""))
    else:
        cleaned, citations = verify_citations(text, sources)
        if citations:
            result.answer, result.citations = cleaned, citations
            result.evidence_status = "supported"
        else:
            result.answer = UNVERIFIED_MESSAGE
    result.latency_ms = int((time.perf_counter() - started) * 1000)
    return result
