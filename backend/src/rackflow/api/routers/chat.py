"""RAG chat sessions, grounded answers with citations, and the retrieval inspector."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from rackflow.audit import record_audit
from rackflow.auth.access import accessible_collections
from rackflow.auth.deps import require
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.errors import NotFoundError, ValidationFailedError
from rackflow.core.ratelimit import chat_limiter
from rackflow.db.models import (
    ChatMessage,
    Citation,
    Conversation,
    Document,
    DocumentStatus,
    EvidenceStatus,
)
from rackflow.db.session import get_db
from rackflow.rag.answer import answer_question
from rackflow.rag.retrieval import authorized_collections, retrieve
from rackflow.tenant_settings import effective_settings

router = APIRouter(tags=["chat"])


class SessionIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    collection_ids: list[uuid.UUID] = Field(min_length=1, max_length=50)


class SessionPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    collection_ids: list[uuid.UUID] | None = Field(default=None, min_length=1, max_length=50)


class SessionOut(BaseModel):
    id: uuid.UUID
    title: str
    collection_ids: list[uuid.UUID]
    created_at: datetime
    updated_at: datetime


class SessionPage(BaseModel):
    items: list[SessionOut]
    next_cursor: str | None = None


class CitationOut(BaseModel):
    marker: int
    document_id: uuid.UUID
    filename: str
    page: int | None
    chunk_id: uuid.UUID | None
    quote: str
    score: float | None


class ModelRef(BaseModel):
    provider: str
    name: str
    deployment_mode: str | None = None


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    evidence_status: str | None
    citations: list[CitationOut]
    model: ModelRef | None
    latency_ms: int | None
    created_at: datetime


class SessionDetail(BaseModel):
    session: SessionOut
    messages: list[MessageOut]


class AskIn(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    collection_ids: list[uuid.UUID] | None = Field(default=None, max_length=50)


class AnswerOut(BaseModel):
    message_id: uuid.UUID
    user_message_id: uuid.UUID
    answer: str
    evidence_status: str
    citations: list[CitationOut]
    model: ModelRef
    latency_ms: int
    retrieved_count: int


class InspectIn(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    collection_ids: list[uuid.UUID] | None = Field(default=None, max_length=50)


class InspectItem(BaseModel):
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    filename: str
    page_start: int | None
    page_end: int | None
    score: float
    text: str


class InspectOut(BaseModel):
    items: list[InspectItem]


def _session_out(c: Conversation) -> SessionOut:
    return SessionOut(id=c.id, title=c.title,
                      collection_ids=[uuid.UUID(x) for x in c.collection_ids],
                      created_at=c.created_at, updated_at=c.updated_at)


def _own_session(db: Session, principal: Principal, session_id: uuid.UUID) -> Conversation:
    conv = db.scalar(select(Conversation).where(
        Conversation.id == session_id, Conversation.tenant_id == principal.tenant_id,
        Conversation.user_id == principal.user_id))
    if conv is None:
        raise NotFoundError(code="SESSION_NOT_FOUND",
                            message="The chat session could not be found.")
    return conv


def _require_collections(db: Session, principal: Principal, ids: list[uuid.UUID]) -> None:
    if len(authorized_collections(db, principal, ids)) != len(set(ids)):
        raise NotFoundError(code="COLLECTION_NOT_FOUND",
                            message="The requested collection could not be found.")


def _session_scope(db: Session, principal: Principal, conv: Conversation) -> list[uuid.UUID]:
    """The session's stored collections that still exist and are still accessible. Collections
    deleted (or revoked) since the session was created are dropped silently, so one deleted
    collection does not break the whole chat; only an empty result is an error."""
    stored = [uuid.UUID(c) for c in conv.collection_ids]
    # Guard the empty case explicitly: authorized_collections() treats "none requested" as
    # "every accessible collection", which would silently widen the scope.
    scope = authorized_collections(db, principal, stored) if stored else []
    if not scope:
        raise NotFoundError(
            code="SESSION_SCOPE_EMPTY",
            message="None of this chat's collections are available any more. "
                    "Choose other collections or start a new chat.",
        )
    return scope


@router.post("/chat/sessions", response_model=SessionOut, status_code=201)
def create_session(
    body: SessionIn,
    principal: Principal = Depends(require(Permission.CHAT_USE)),
    db: Session = Depends(get_db),
) -> SessionOut:
    _require_collections(db, principal, body.collection_ids)
    conv = Conversation(tenant_id=principal.tenant_id, user_id=principal.user_id,
                        title=(body.title or "New conversation").strip()[:200],
                        collection_ids=[str(c) for c in dict.fromkeys(body.collection_ids)])
    db.add(conv)
    db.commit()
    return _session_out(conv)


@router.get("/chat/sessions", response_model=SessionPage)
def list_sessions(
    limit: int = Query(default=50, ge=1, le=200),
    principal: Principal = Depends(require(Permission.CHAT_USE)),
    db: Session = Depends(get_db),
) -> SessionPage:
    rows = db.scalars(select(Conversation).where(
        Conversation.tenant_id == principal.tenant_id, Conversation.user_id == principal.user_id)
        .order_by(Conversation.updated_at.desc()).limit(limit)).all()
    return SessionPage(items=[_session_out(c) for c in rows])


@router.get("/chat/sessions/{session_id}", response_model=SessionDetail)
def get_session(
    session_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.CHAT_USE)),
    db: Session = Depends(get_db),
) -> SessionDetail:
    conv = _own_session(db, principal, session_id)
    messages = db.scalars(select(ChatMessage).where(ChatMessage.conversation_id == conv.id)
                          .order_by(ChatMessage.created_at)).all()
    # Re-authorise stored citations on every read (ADR-009): hide sources that were deleted or
    # that the caller can no longer access.
    allowed = set(accessible_collections(db, principal))
    rows = db.execute(
        select(Citation, Document.filename, Document.collection_id, Document.status)
        .join(Document, Document.id == Citation.document_id)
        .where(Citation.message_id.in_([m.id for m in messages]),
               Citation.tenant_id == principal.tenant_id)
        .order_by(Citation.marker)
    ).all() if messages else []
    by_message: dict[uuid.UUID, list[CitationOut]] = {}
    for cit, filename, collection_id, status in rows:
        if collection_id in allowed and status == DocumentStatus.INDEXED:
            by_message.setdefault(cit.message_id, []).append(CitationOut(
                marker=cit.marker, document_id=cit.document_id, filename=filename,
                page=cit.page, chunk_id=cit.chunk_id, quote=cit.quote, score=cit.rank_score))
    return SessionDetail(session=_session_out(conv), messages=[
        MessageOut(
            id=m.id, role=m.role, content=m.content,
            evidence_status=m.evidence_status.value if m.evidence_status else None,
            citations=by_message.get(m.id, []),
            model=ModelRef(provider=m.model_provider, name=m.model_name or "")
            if m.model_provider else None,
            latency_ms=m.latency_ms, created_at=m.created_at,
        )
        for m in messages
    ])


@router.patch("/chat/sessions/{session_id}", response_model=SessionOut)
def update_session(
    session_id: uuid.UUID,
    body: SessionPatch,
    principal: Principal = Depends(require(Permission.CHAT_USE)),
    db: Session = Depends(get_db),
) -> SessionOut:
    """Rename and/or re-scope the caller's own chat. `updated_at` is left alone: it orders the
    history by last activity, and a rename is not activity (UI spec §5.10)."""
    conv = _own_session(db, principal, session_id)
    values: dict[str, Any] = {}
    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise ValidationFailedError(code="INVALID_TITLE", message="The title cannot be empty.")
        values["title"] = title
    if body.collection_ids is not None:
        _require_collections(db, principal, body.collection_ids)
        values["collection_ids"] = [str(c) for c in dict.fromkeys(body.collection_ids)]
    if not values:
        return _session_out(conv)
    # A Core UPDATE that sets updated_at to itself; the ORM `onupdate` would otherwise bump it.
    db.execute(update(Conversation).where(Conversation.id == conv.id)
               .values(**values, updated_at=Conversation.updated_at)
               .execution_options(synchronize_session=False))
    # Audit metadata is counts only: the title is usually the user's first question.
    if "title" in values:
        record_audit(db, action="chat.session.rename", resource_type="chat_session",
                     resource_id=conv.id, principal=principal)
    if "collection_ids" in values:
        record_audit(db, action="chat.session.update", resource_type="chat_session",
                     resource_id=conv.id, principal=principal,
                     metadata={"collections": len(values["collection_ids"])})
    db.commit()
    db.refresh(conv)
    return _session_out(conv)


@router.delete("/chat/sessions/{session_id}", status_code=204)
def delete_session(
    session_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.CHAT_USE)),
    db: Session = Depends(get_db),
) -> Response:
    conv = _own_session(db, principal, session_id)
    messages = db.scalar(select(func.count()).select_from(ChatMessage)
                         .where(ChatMessage.conversation_id == conv.id)) or 0
    db.delete(conv)  # messages and their citations go with it (ON DELETE CASCADE)
    record_audit(db, action="chat.session.delete", resource_type="chat_session",
                 resource_id=conv.id, principal=principal, metadata={"messages": messages})
    db.commit()
    return Response(status_code=204)


@router.post("/chat/sessions/{session_id}/messages", response_model=AnswerOut)
def ask(
    session_id: uuid.UUID,
    body: AskIn,
    principal: Principal = Depends(require(Permission.CHAT_USE)),
    db: Session = Depends(get_db),
) -> AnswerOut:
    chat_limiter.hit(f"{principal.tenant_id}:{principal.user_id}")
    conv = _own_session(db, principal, session_id)
    if body.collection_ids:  # an explicit per-message override must be fully accessible
        collection_ids = body.collection_ids
        _require_collections(db, principal, collection_ids)
    else:
        collection_ids = _session_scope(db, principal, conv)

    result = answer_question(db, principal, body.message.strip(), collection_ids)

    user_msg = ChatMessage(tenant_id=principal.tenant_id, conversation_id=conv.id, role="user",
                           content=body.message.strip())
    db.add(user_msg)
    db.flush()
    assistant = ChatMessage(
        tenant_id=principal.tenant_id, conversation_id=conv.id, role="assistant",
        content=result.answer, evidence_status=EvidenceStatus(result.evidence_status),
        model_provider=result.provider, model_name=result.model, latency_ms=result.latency_ms,
        prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
        retrieval_stats={"retrieved": result.retrieved_count,
                         "cited": len(result.citations)},
    )
    db.add(assistant)
    db.flush()
    citations: list[CitationOut] = []
    for c in result.citations:
        db.add(Citation(tenant_id=principal.tenant_id, message_id=assistant.id,
                        document_id=c.chunk.document_id, chunk_id=c.chunk.chunk_id,
                        marker=c.marker, page=c.chunk.page_start, quote=c.quote,
                        rank_score=c.chunk.score))
        citations.append(CitationOut(marker=c.marker, document_id=c.chunk.document_id,
                                     filename=c.chunk.filename, page=c.chunk.page_start,
                                     chunk_id=c.chunk.chunk_id, quote=c.quote,
                                     score=c.chunk.score))
    if conv.title == "New conversation":
        conv.title = body.message.strip()[:80]
    conv.updated_at = assistant.created_at
    db.commit()
    return AnswerOut(
        message_id=assistant.id, user_message_id=user_msg.id, answer=result.answer,
        evidence_status=result.evidence_status, citations=citations,
        model=ModelRef(provider=result.provider, name=result.model,
                       deployment_mode=result.deployment_mode),
        latency_ms=result.latency_ms, retrieved_count=result.retrieved_count,
    )


@router.post("/retrieval/inspect", response_model=InspectOut)
def inspect(
    body: InspectIn,
    principal: Principal = Depends(require(Permission.RETRIEVAL_INSPECT)),
    db: Session = Depends(get_db),
) -> InspectOut:
    chat_limiter.hit(f"{principal.tenant_id}:{principal.user_id}")
    settings = effective_settings(db, principal.tenant_id)
    if body.collection_ids:
        _require_collections(db, principal, body.collection_ids)
    chunks = retrieve(db, principal, body.query, body.collection_ids,
                      top_k=settings.retrieval_top_k,
                      score_threshold=settings.retrieval_score_threshold)
    record_audit(db, action="retrieval.inspect", resource_type="collection", principal=principal,
                 metadata={"results": len(chunks)})
    db.commit()
    return InspectOut(items=[InspectItem(chunk_id=c.chunk_id, document_id=c.document_id,
                                         filename=c.filename, page_start=c.page_start,
                                         page_end=c.page_end, score=c.score, text=c.text)
                             for c in chunks])
