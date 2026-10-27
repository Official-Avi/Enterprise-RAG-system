"""Accepting an upload: validate → dedupe → quota → store → document row + ingest job, in one
transaction. Shared by the upload API and the evaluation seeder so both follow the same path."""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rackflow.audit import record_audit
from rackflow.db.models import Document, DocumentStatus, JobType
from rackflow.ingestion.validation import UploadRejected, validate_upload
from rackflow.jobs.enqueue import enqueue_job
from rackflow.providers.storage import document_key, get_object_storage
from rackflow.tenant_settings import EffectiveSettings


@dataclass(slots=True)
class AcceptResult:
    filename: str
    status: str  # queued | duplicate | rejected
    document_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None
    error_code: str | None = None
    error_message: str | None = None
    stored_bytes: int = 0


def used_storage_bytes(db: Session, tenant_id: uuid.UUID) -> int:
    return int(db.scalar(select(func.coalesce(func.sum(Document.size_bytes), 0)).where(
        Document.tenant_id == tenant_id, Document.deleted_at.is_(None))) or 0)


def accept_upload(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    collection_id: uuid.UUID,
    user_id: uuid.UUID | None,
    filename: str | None,
    data: bytes,
    settings: EffectiveSettings,
    used_bytes: int,
) -> AcceptResult:
    """Commits on success. Never raises for invalid input — returns a `rejected` result."""
    try:
        checked = validate_upload(filename, data, max_bytes=settings.upload_max_bytes)
    except UploadRejected as exc:
        return AcceptResult(filename=(filename or "upload")[:200], status="rejected",
                            error_code=exc.code, error_message=exc.message)
    quota = settings.max_storage_bytes
    if quota is not None and used_bytes + len(data) > quota:
        return AcceptResult(filename=checked.filename, status="rejected",
                            error_code="QUOTA_EXCEEDED",
                            error_message="The workspace storage quota has been reached.")

    content_hash = hashlib.sha256(data).hexdigest()
    existing = db.scalar(select(Document.id).where(
        Document.tenant_id == tenant_id, Document.collection_id == collection_id,
        Document.content_hash == content_hash, Document.deleted_at.is_(None)))
    if existing is not None:
        return AcceptResult(filename=checked.filename, status="duplicate", document_id=existing)

    storage = get_object_storage()
    doc_id = uuid.uuid4()
    key = document_key(tenant_id, doc_id)
    storage.put(key, data)
    try:
        db.add(Document(
            id=doc_id, tenant_id=tenant_id, collection_id=collection_id,
            filename=checked.filename, file_type=checked.file_type, mime_type=checked.mime_type,
            size_bytes=checked.size_bytes, content_hash=content_hash, storage_key=key,
            status=DocumentStatus.QUEUED, warnings=[], uploaded_by=user_id,
        ))
        db.flush()
        job = enqueue_job(
            db, tenant_id=tenant_id, job_type=JobType.INGEST_DOCUMENT,
            idempotency_key=f"ingest:{doc_id}:v1", document_id=doc_id,
            collection_id=collection_id, payload={"document_id": str(doc_id), "version": 1},
            created_by=user_id,
        )
        record_audit(db, action="document.upload", resource_type="document", resource_id=doc_id,
                     tenant_id=tenant_id, actor_user_id=user_id,
                     metadata={"collection_id": str(collection_id),
                               "size_bytes": checked.size_bytes, "file_type": checked.file_type})
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(key)
        raise
    return AcceptResult(filename=checked.filename, status="queued", document_id=doc_id,
                        job_id=job.id, stored_bytes=len(data))
