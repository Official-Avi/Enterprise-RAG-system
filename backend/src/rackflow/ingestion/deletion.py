"""DELETE_DOCUMENT job handler (ADR-009): vectors → stored object → rows. Idempotent; the
document row remains as a DELETED tombstone for audit."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete

from rackflow.db.models import Chunk, Document, DocumentStatus, DocumentVersion, PipelineStage
from rackflow.jobs.context import JobContext
from rackflow.jobs.errors import RetryableJobError
from rackflow.providers.storage import get_object_storage


def delete_document(ctx: JobContext) -> None:
    from rackflow.rag.indexing import delete_document_vectors

    db = ctx.db
    document_id = uuid.UUID(str(ctx.payload["document_id"]))
    doc = db.get(Document, document_id)
    if doc is None or doc.tenant_id != ctx.tenant_id:
        return
    storage_key = doc.storage_key

    with ctx.stage(PipelineStage.DELETE_VECTORS):
        delete_document_vectors(ctx.tenant_id, document_id)

    with ctx.stage(PipelineStage.DELETE_OBJECTS):
        try:
            get_object_storage().delete(storage_key)
        except OSError as exc:
            raise RetryableJobError("STORAGE_UNAVAILABLE", "File storage is unavailable.") from exc

    with ctx.stage(PipelineStage.DELETE_ROWS) as rec:
        result = db.execute(delete(Chunk).where(Chunk.document_id == document_id))
        db.execute(delete(DocumentVersion).where(DocumentVersion.document_id == document_id))
        doc = db.get(Document, document_id)
        if doc is not None:
            doc.status = DocumentStatus.DELETED
            doc.current_version_id = None
            doc.deleted_at = doc.deleted_at or datetime.now(UTC)
        rec.details = {"chunks_deleted": getattr(result, "rowcount", 0) or 0}
