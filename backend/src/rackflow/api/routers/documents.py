"""Document upload, listing, pipeline status, chunks, retry, download and deletion."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from rackflow.api.pagination import decode_cursor, encode_cursor
from rackflow.api.schemas import (
    AttemptOut,
    JobBrief,
    JobOut,
    StageRunOut,
    attempt_out,
    job_brief,
    job_out,
    stage_out,
)
from rackflow.audit import record_audit
from rackflow.auth.access import accessible_collections, require_collection, visible_collection_ids
from rackflow.auth.deps import require
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.errors import ConflictError, ForbiddenError, NotFoundError, PayloadTooLargeError
from rackflow.core.ratelimit import upload_limiter
from rackflow.db.models import (
    Chunk,
    Collection,
    CollectionPermissionLevel,
    Document,
    DocumentStatus,
    JobAttempt,
    JobType,
    PipelineStageRun,
    ProcessingJob,
    Role,
)
from rackflow.db.session import get_db
from rackflow.ingestion.service import accept_upload, next_ingest_version, used_storage_bytes
from rackflow.jobs.enqueue import enqueue_job
from rackflow.providers.storage import get_object_storage
from rackflow.tenant_settings import effective_settings

router = APIRouter(tags=["documents"])
MAX_FILES_PER_REQUEST = 20
_READ_CHUNK = 1024 * 1024


class UploadError(BaseModel):
    code: str
    message: str


class UploadItem(BaseModel):
    filename: str
    status: str  # queued | duplicate | rejected
    document_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None
    duplicate: bool = False
    error: UploadError | None = None


class UploadResult(BaseModel):
    items: list[UploadItem]


class DocumentOut(BaseModel):
    id: uuid.UUID
    collection_id: uuid.UUID
    collection_name: str
    filename: str
    file_type: str
    mime_type: str
    size_bytes: int
    status: DocumentStatus
    page_count: int | None
    chunk_count: int | None
    token_count: int | None
    extraction_method: str | None
    ocr_page_count: int | None
    quality_score: float | None
    warnings: list[str]
    pipeline_version: str | None
    embedding_model: str | None
    uploaded_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    indexed_at: datetime | None
    latest_job: JobBrief | None


class DocumentPage(BaseModel):
    items: list[DocumentOut]
    next_cursor: str | None


class PipelineJob(JobOut):
    attempts: list[AttemptOut]
    stages: list[StageRunOut]


class PipelineOut(BaseModel):
    document_id: uuid.UUID
    status: DocumentStatus
    jobs: list[PipelineJob]


class ChunkOut(BaseModel):
    id: uuid.UUID
    chunk_index: int
    page_start: int | None
    page_end: int | None
    token_count: int
    text: str


class ChunkPage(BaseModel):
    items: list[ChunkOut]
    next_cursor: str | None


class JobRef(BaseModel):
    document_id: uuid.UUID
    job_id: uuid.UUID
    status: str


# ------------------------------------------------------------------ helpers


def _latest_jobs(db: Session, doc_ids: list[uuid.UUID]) -> dict[uuid.UUID, ProcessingJob]:
    if not doc_ids:
        return {}
    rows = db.scalars(
        select(ProcessingJob)
        .where(ProcessingJob.document_id.in_(doc_ids))
        .order_by(ProcessingJob.document_id, ProcessingJob.queued_at.desc())
        .distinct(ProcessingJob.document_id)
    ).all()
    return {j.document_id: j for j in rows if j.document_id}


def _out(doc: Document, collection_name: str, job: ProcessingJob | None) -> DocumentOut:
    return DocumentOut(
        id=doc.id, collection_id=doc.collection_id, collection_name=collection_name,
        filename=doc.filename, file_type=doc.file_type, mime_type=doc.mime_type,
        size_bytes=doc.size_bytes, status=doc.status, page_count=doc.page_count,
        chunk_count=doc.chunk_count, token_count=doc.token_count,
        extraction_method=doc.extraction_method, ocr_page_count=doc.ocr_page_count,
        quality_score=doc.quality_score, warnings=list(doc.warnings or []),
        pipeline_version=doc.pipeline_version, embedding_model=doc.embedding_model,
        uploaded_by=doc.uploaded_by, created_at=doc.created_at, updated_at=doc.updated_at,
        indexed_at=doc.indexed_at, latest_job=job_brief(job) if job else None,
    )


def _visible_document(db: Session, principal: Principal, document_id: uuid.UUID) -> Document:
    doc = db.scalar(select(Document).where(Document.id == document_id,
                                           Document.tenant_id == principal.tenant_id,
                                           Document.status != DocumentStatus.DELETED))
    if doc is None or doc.collection_id not in visible_collection_ids(db, principal):
        raise NotFoundError(code="DOCUMENT_NOT_FOUND",
                            message="The requested document could not be found.")
    return doc


def _content_document(db: Session, principal: Principal, document_id: uuid.UUID,
                      minimum: CollectionPermissionLevel) -> tuple[Document, Any]:
    doc = _visible_document(db, principal, document_id)
    level = accessible_collections(db, principal, minimum).get(doc.collection_id)
    if level is None:
        raise NotFoundError(code="DOCUMENT_NOT_FOUND",
                            message="The requested document could not be found.")
    return doc, level


async def _read_capped(upload: UploadFile, max_bytes: int) -> bytes:
    buf = bytearray()
    while True:
        chunk = await upload.read(_READ_CHUNK)
        if not chunk:
            return bytes(buf)
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise PayloadTooLargeError(code="FILE_TOO_LARGE",
                                       message=f"Files must be at most {max_bytes // 1048576} MiB.")


# ------------------------------------------------------------------ routes


@router.post("/collections/{collection_id}/documents", response_model=UploadResult,
             status_code=201)
async def upload_documents(
    collection_id: uuid.UUID,
    request: Request,
    files: list[UploadFile],
    principal: Principal = Depends(require(Permission.DOCUMENT_UPLOAD)),
    db: Session = Depends(get_db),
) -> UploadResult:
    upload_limiter.hit(f"{principal.tenant_id}:{principal.user_id}")
    collection = require_collection(db, principal, collection_id,
                                    minimum=CollectionPermissionLevel.WRITE)
    if not files or len(files) > MAX_FILES_PER_REQUEST:
        raise ConflictError(code="TOO_MANY_FILES",
                            message=f"Upload between 1 and {MAX_FILES_PER_REQUEST} files at once.")
    settings = effective_settings(db, principal.tenant_id)
    used = used_storage_bytes(db, principal.tenant_id)
    items: list[UploadItem] = []
    for upload in files:
        name = upload.filename or "upload"
        try:
            data = await _read_capped(upload, settings.upload_max_bytes)
        except PayloadTooLargeError as exc:
            items.append(UploadItem(filename=name[:200], status="rejected",
                                    error=UploadError(code=exc.code, message=exc.message)))
            continue
        result = accept_upload(db, tenant_id=principal.tenant_id, collection_id=collection.id,
                               user_id=principal.user_id, filename=name, data=data,
                               settings=settings, used_bytes=used)
        used += result.stored_bytes
        items.append(UploadItem(
            filename=result.filename, status=result.status, document_id=result.document_id,
            job_id=result.job_id, duplicate=result.status == "duplicate",
            error=UploadError(code=result.error_code, message=result.error_message or "")
            if result.error_code else None,
        ))
    return UploadResult(items=items)


@router.get("/documents", response_model=DocumentPage)
def list_documents(
    collection_id: uuid.UUID | None = None,
    status: DocumentStatus | None = None,
    file_type: str | None = Query(default=None, max_length=16),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
    principal: Principal = Depends(require(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
) -> DocumentPage:
    visible = visible_collection_ids(db, principal)
    if collection_id is not None:
        visible &= {collection_id}
    if not visible:
        return DocumentPage(items=[], next_cursor=None)
    stmt = (select(Document, Collection.name)
            .join(Collection, Collection.id == Document.collection_id)
            .where(Document.tenant_id == principal.tenant_id,
                   Document.collection_id.in_(visible),
                   Document.status != DocumentStatus.DELETED))
    if status is not None:
        stmt = stmt.where(Document.status == status)
    if file_type:
        stmt = stmt.where(Document.file_type == file_type.lower())
    if q:
        stmt = stmt.where(Document.filename.ilike(f"%{q.replace('%', '').replace('_', '')}%"))
    if cursor:
        ts, last_id = decode_cursor(cursor)
        stmt = stmt.where(or_(Document.created_at < ts,
                              (Document.created_at == ts) & (Document.id < last_id)))
    rows = db.execute(stmt.order_by(Document.created_at.desc(), Document.id.desc())
                      .limit(limit + 1)).all()
    page = rows[:limit]
    jobs = _latest_jobs(db, [d.id for d, _ in page])
    next_cursor = (encode_cursor(page[-1][0].created_at, page[-1][0].id)
                   if len(rows) > limit else None)
    return DocumentPage(items=[_out(d, name, jobs.get(d.id)) for d, name in page],
                        next_cursor=next_cursor)


@router.get("/documents/{document_id}", response_model=DocumentOut)
def get_document(
    document_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
) -> DocumentOut:
    doc = _visible_document(db, principal, document_id)
    name = db.scalar(select(Collection.name).where(Collection.id == doc.collection_id)) or ""
    return _out(doc, name, _latest_jobs(db, [doc.id]).get(doc.id))


@router.get("/documents/{document_id}/pipeline", response_model=PipelineOut)
def get_pipeline(
    document_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.COLLECTION_READ)),
    db: Session = Depends(get_db),
) -> PipelineOut:
    doc = _visible_document(db, principal, document_id)
    jobs = db.scalars(select(ProcessingJob).where(ProcessingJob.document_id == doc.id,
                                                  ProcessingJob.tenant_id == principal.tenant_id)
                      .order_by(ProcessingJob.queued_at.desc())).all()
    out: list[PipelineJob] = []
    for job in jobs:
        attempts = db.scalars(select(JobAttempt).where(JobAttempt.job_id == job.id)
                              .order_by(JobAttempt.attempt_number)).all()
        stages = db.scalars(select(PipelineStageRun).where(PipelineStageRun.job_id == job.id)
                            .order_by(PipelineStageRun.started_at)).all()
        out.append(PipelineJob(**job_out(job, doc.filename).model_dump(),
                               attempts=[attempt_out(a) for a in attempts],
                               stages=[stage_out(s) for s in stages]))
    return PipelineOut(document_id=doc.id, status=doc.status, jobs=out)


@router.get("/documents/{document_id}/chunks", response_model=ChunkPage)
def list_chunks(
    document_id: uuid.UUID,
    page: int | None = Query(default=None, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
    principal: Principal = Depends(require(Permission.DOCUMENT_READ_CONTENT)),
    db: Session = Depends(get_db),
) -> ChunkPage:
    doc, _ = _content_document(db, principal, document_id, CollectionPermissionLevel.READ)
    if doc.current_version_id is None:
        return ChunkPage(items=[], next_cursor=None)
    stmt = select(Chunk).where(Chunk.document_version_id == doc.current_version_id,
                               Chunk.tenant_id == principal.tenant_id)
    if page is not None:
        stmt = stmt.where(Chunk.page_start <= page, Chunk.page_end >= page)
    start = int(cursor) if cursor and cursor.isdigit() else 0
    rows = db.scalars(stmt.where(Chunk.chunk_index >= start).order_by(Chunk.chunk_index)
                      .limit(limit + 1)).all()
    items = [ChunkOut(id=c.id, chunk_index=c.chunk_index, page_start=c.page_start,
                      page_end=c.page_end, token_count=c.token_count, text=c.text)
             for c in rows[:limit]]
    return ChunkPage(items=items,
                     next_cursor=str(rows[limit].chunk_index) if len(rows) > limit else None)


@router.post("/documents/{document_id}/retry", response_model=JobRef, status_code=202)
def retry_document(
    document_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.DOCUMENT_RETRY)),
    db: Session = Depends(get_db),
) -> JobRef:
    doc, _ = _content_document(db, principal, document_id, CollectionPermissionLevel.WRITE)
    if doc.status != DocumentStatus.FAILED:
        raise ConflictError(code="NOT_RETRYABLE", message="Only failed documents can be retried.")
    version = next_ingest_version(db, doc.id)
    job = enqueue_job(db, tenant_id=principal.tenant_id, job_type=JobType.INGEST_DOCUMENT,
                      idempotency_key=f"ingest:{doc.id}:v{version}", document_id=doc.id,
                      collection_id=doc.collection_id,
                      payload={"document_id": str(doc.id), "version": version},
                      created_by=principal.user_id)
    doc.status = DocumentStatus.QUEUED
    record_audit(db, action="document.retry", resource_type="document", resource_id=doc.id,
                 principal=principal, metadata={"version": version})
    db.commit()
    return JobRef(document_id=doc.id, job_id=job.id, status="queued")


@router.delete("/documents/{document_id}", response_model=JobRef, status_code=202)
def delete_document(
    document_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.DOCUMENT_DELETE)),
    db: Session = Depends(get_db),
) -> JobRef:
    doc, level = _content_document(db, principal, document_id, CollectionPermissionLevel.WRITE)
    if (principal.role != Role.ORG_ADMIN and level != CollectionPermissionLevel.MANAGE
            and doc.uploaded_by != principal.user_id):
        raise ForbiddenError(message="Only the uploader or a collection manager can delete it.")
    if doc.status == DocumentStatus.DELETING:
        raise ConflictError(code="ALREADY_DELETING", message="The document is being deleted.")
    for job in db.scalars(select(ProcessingJob).where(
            ProcessingJob.document_id == doc.id,
            ProcessingJob.status.in_(["queued", "retry_wait", "running"]))).all():
        from rackflow.jobs.queue import request_cancel

        request_cancel(db, job)
    doc.status = DocumentStatus.DELETING
    doc.deleted_at = datetime.now(UTC)  # frees the dedup slot and hides it from retrieval
    job = enqueue_job(db, tenant_id=principal.tenant_id, job_type=JobType.DELETE_DOCUMENT,
                      idempotency_key=f"delete:{doc.id}", document_id=doc.id,
                      collection_id=doc.collection_id, payload={"document_id": str(doc.id)},
                      priority=50, created_by=principal.user_id)
    record_audit(db, action="document.delete", resource_type="document", resource_id=doc.id,
                 principal=principal)
    db.commit()
    return JobRef(document_id=doc.id, job_id=job.id, status="deleting")


@router.get("/documents/{document_id}/download")
def download_document(
    document_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.DOCUMENT_READ_CONTENT)),
    db: Session = Depends(get_db),
) -> Response:
    doc, _ = _content_document(db, principal, document_id, CollectionPermissionLevel.READ)
    data = get_object_storage().get(doc.storage_key)
    record_audit(db, action="document.download", resource_type="document", resource_id=doc.id,
                 principal=principal)
    db.commit()
    ascii_name = doc.filename.encode("ascii", "ignore").decode().replace('"', "") or "document"
    return Response(content=data, media_type="application/octet-stream", headers={
        "Content-Disposition": f'attachment; filename="{ascii_name}"',
        "X-Content-Type-Options": "nosniff",
    })
