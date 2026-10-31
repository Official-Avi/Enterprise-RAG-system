"""EMBED and INDEX pipeline stages, plus vector cleanup. Idempotent: vector IDs are chunk IDs,
so re-running a job overwrites the same points instead of duplicating them."""

from __future__ import annotations

import uuid

from sqlalchemy import select, update

from rackflow import PIPELINE_VERSION
from rackflow.db.models import Chunk, Document, DocumentVersion, PipelineStage
from rackflow.jobs.context import JobContext
from rackflow.jobs.errors import (
    DependencyUnavailable,
    PermanentJobError,
    RetryableJobError,
    is_dependency_failure,
)
from rackflow.providers.embeddings import get_embedding_provider
from rackflow.providers.interfaces import VectorRecord
from rackflow.providers.vectorstore import VectorDimensionMismatch, get_vector_store

EMBED_BATCH = 64
UPSERT_BATCH = 128


def index_document_version(ctx: JobContext, version_id: uuid.UUID) -> None:
    db = ctx.db
    chunks = db.scalars(
        select(Chunk)
        .where(Chunk.document_version_id == version_id, Chunk.tenant_id == ctx.tenant_id)
        .order_by(Chunk.chunk_index)
    ).all()

    vectors: list[list[float]] = []
    # Providers are built inside their stage so a failure to load them is recorded against
    # EMBED / INDEX, not against the previous stage.
    with ctx.stage(PipelineStage.EMBED) as rec:
        try:
            embedder = get_embedding_provider()
            for i in range(0, len(chunks), EMBED_BATCH):
                batch = [c.text for c in chunks[i:i + EMBED_BATCH]]
                vectors.extend(embedder.embed_documents(batch))
                ctx.heartbeat()
        except Exception as exc:  # noqa: BLE001 — provider errors are transient by default
            if is_dependency_failure(exc):  # e.g. the ONNX runtime cannot load on this host
                raise DependencyUnavailable() from exc
            raise RetryableJobError("EMBEDDING_FAILED", "Embedding generation failed.") from exc
        rec.details = {"chunks": len(chunks), "model": embedder.model_name,
                       "dimension": embedder.dimension}

    with ctx.stage(PipelineStage.INDEX) as rec:
        records = [
            VectorRecord(
                id=c.id,
                vector=v,
                payload={
                    "tenant_id": str(c.tenant_id),
                    "collection_id": str(c.collection_id),
                    "document_id": str(c.document_id),
                    "document_version_id": str(c.document_version_id),
                    "chunk_index": c.chunk_index,
                    "page_start": c.page_start,
                    "page_end": c.page_end,
                    "embedding_model": embedder.model_name,
                    "pipeline_version": PIPELINE_VERSION,
                },
            )
            for c, v in zip(chunks, vectors, strict=True)
        ]
        document_id = chunks[0].document_id if chunks else None
        try:
            store = get_vector_store()
            store.ensure_collection(embedder.dimension)
            for i in range(0, len(records), UPSERT_BATCH):
                store.upsert(records[i:i + UPSERT_BATCH])
                ctx.heartbeat()
            stored = (store.count_document(ctx.tenant_id, document_id, version_id=version_id)
                      if document_id else 0)
        except VectorDimensionMismatch as exc:
            raise PermanentJobError(
                "VECTOR_DIMENSION_MISMATCH",
                "The vector index was built with a different embedding model.",
            ) from exc
        except Exception as exc:  # noqa: BLE001
            raise RetryableJobError("VECTOR_STORE_UNAVAILABLE",
                                    "The vector store is unavailable.") from exc
        if stored != len(records):
            raise RetryableJobError("INDEX_VERIFY_FAILED",
                                    "Indexed vector count did not match the chunk count.")
        db.execute(update(DocumentVersion).where(DocumentVersion.id == version_id)
                   .values(embedding_model=embedder.model_name))
        if document_id:
            db.execute(update(Document).where(Document.id == document_id)
                       .values(embedding_model=embedder.model_name))
        rec.details = {"vectors": stored}


def delete_document_vectors(
    tenant_id: uuid.UUID, document_id: uuid.UUID, *, except_version_id: uuid.UUID | None = None
) -> None:
    try:
        get_vector_store().delete_document(tenant_id, document_id,
                                           except_version_id=except_version_id)
    except Exception as exc:  # noqa: BLE001
        raise RetryableJobError("VECTOR_STORE_UNAVAILABLE",
                                "The vector store is unavailable.") from exc
