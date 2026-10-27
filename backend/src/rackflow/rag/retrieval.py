"""Permission-aware retrieval (ARCHITECTURE §4.2, FR-030/031).

Authorization happens BEFORE any content reaches the model: requested collections are
intersected with the caller's accessible collections, the vector search is tenant- and
collection-filtered, and every hit is re-validated against PostgreSQL (document indexed, not
deleted, current version, same tenant). The vector store is never the only check.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.auth.access import accessible_collections
from rackflow.auth.principal import Principal
from rackflow.core.errors import ServiceUnavailableError
from rackflow.db.models import Chunk, Document, DocumentStatus
from rackflow.providers.embeddings import get_embedding_provider
from rackflow.providers.interfaces import VectorFilter
from rackflow.providers.vectorstore import get_vector_store

log = logging.getLogger(__name__)
CANDIDATE_MULTIPLIER = 3


@dataclass(slots=True)
class RetrievedChunk:
    chunk_id: uuid.UUID
    document_id: uuid.UUID
    collection_id: uuid.UUID
    filename: str
    page_start: int | None
    page_end: int | None
    score: float
    text: str


def authorized_collections(db: Session, principal: Principal,
                           requested: Sequence[uuid.UUID] | None) -> list[uuid.UUID]:
    allowed = accessible_collections(db, principal)
    if requested:
        return [c for c in dict.fromkeys(requested) if c in allowed]
    return list(allowed)


def retrieve(
    db: Session,
    principal: Principal,
    query: str,
    collection_ids: Sequence[uuid.UUID] | None,
    *,
    top_k: int,
    score_threshold: float,
) -> list[RetrievedChunk]:
    targets = authorized_collections(db, principal, collection_ids)
    if not targets:
        return []
    try:
        vector = get_embedding_provider().embed_query(query)
        hits = get_vector_store().search(
            vector, VectorFilter(tenant_id=principal.tenant_id, collection_ids=targets),
            limit=top_k * CANDIDATE_MULTIPLIER, score_threshold=score_threshold,
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("retrieval_backend_error", extra={"exc_type": type(exc).__name__})
        raise ServiceUnavailableError(
            code="RETRIEVAL_UNAVAILABLE", message="Document search is temporarily unavailable.",
        ) from exc
    if not hits:
        return []

    rows = db.execute(
        select(Chunk, Document.filename)
        .join(Document, Document.id == Chunk.document_id)
        .where(
            Chunk.id.in_([h.id for h in hits]),
            Chunk.tenant_id == principal.tenant_id,
            Document.tenant_id == principal.tenant_id,
            Chunk.collection_id.in_(targets),
            Document.status == DocumentStatus.INDEXED,
            Document.deleted_at.is_(None),
            Document.current_version_id == Chunk.document_version_id,
        )
    ).all()
    by_id = {chunk.id: (chunk, filename) for chunk, filename in rows}

    results: list[RetrievedChunk] = []
    seen_hashes: set[str] = set()
    for hit in hits:  # already ordered by score
        found = by_id.get(hit.id)
        if found is None:
            continue  # stale/unauthorized vector: never returned
        chunk, filename = found
        if chunk.content_hash in seen_hashes:
            continue
        seen_hashes.add(chunk.content_hash)
        results.append(RetrievedChunk(
            chunk_id=chunk.id, document_id=chunk.document_id, collection_id=chunk.collection_id,
            filename=filename, page_start=chunk.page_start, page_end=chunk.page_end,
            score=round(hit.score, 4), text=chunk.text,
        ))
        if len(results) == top_k:
            break
    return results
