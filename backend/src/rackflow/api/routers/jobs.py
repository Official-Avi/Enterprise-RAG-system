"""Job queue listing, detail, retry and cancel (tenant-scoped; ADR-010)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session

from rackflow.api.pagination import decode_cursor, encode_cursor
from rackflow.api.schemas import (
    AttemptOut,
    JobOut,
    StageRunOut,
    attempt_out,
    job_out,
    stage_out,
)
from rackflow.audit import record_audit
from rackflow.auth.access import visible_collection_ids
from rackflow.auth.deps import require
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.errors import ConflictError, NotFoundError
from rackflow.db.models import (
    Document,
    JobAttempt,
    JobStatus,
    JobType,
    PipelineStageRun,
    ProcessingJob,
    Role,
)
from rackflow.db.session import get_db
from rackflow.jobs.queue import InvalidTransition, manual_retry, request_cancel

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobPage(BaseModel):
    items: list[JobOut]
    next_cursor: str | None


class JobDetail(JobOut):
    attempts: list[AttemptOut]
    stages: list[StageRunOut]


def scoped_jobs(db: Session, principal: Principal) -> Select[ProcessingJob, str]:
    """Jobs the caller may see, joined with the document filename."""
    stmt = (select(ProcessingJob, Document.filename)
            .outerjoin(Document, Document.id == ProcessingJob.document_id)
            .where(ProcessingJob.tenant_id == principal.tenant_id))
    if principal.role == Role.ENGINEER:
        visible = visible_collection_ids(db, principal)
        stmt = stmt.where(or_(ProcessingJob.collection_id.in_(visible),
                              ProcessingJob.created_by == principal.user_id))
    return stmt


def _load(db: Session, principal: Principal, job_id: uuid.UUID) -> tuple[ProcessingJob, str | None]:
    row = db.execute(scoped_jobs(db, principal).where(ProcessingJob.id == job_id)).first()
    if row is None:
        raise NotFoundError(code="JOB_NOT_FOUND", message="The requested job could not be found.")
    return row[0], row[1]


def _detail(db: Session, job: ProcessingJob, filename: str | None) -> JobDetail:
    attempts = db.scalars(select(JobAttempt).where(JobAttempt.job_id == job.id)
                          .order_by(JobAttempt.attempt_number)).all()
    stages = db.scalars(select(PipelineStageRun).where(PipelineStageRun.job_id == job.id)
                        .order_by(PipelineStageRun.started_at)).all()
    return JobDetail(**job_out(job, filename).model_dump(),
                     attempts=[attempt_out(a) for a in attempts],
                     stages=[stage_out(s) for s in stages])


@router.get("", response_model=JobPage)
def list_jobs(
    status: JobStatus | None = None,
    job_type: JobType | None = None,
    collection_id: uuid.UUID | None = None,
    document_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
    principal: Principal = Depends(require(Permission.JOB_READ)),
    db: Session = Depends(get_db),
) -> JobPage:
    stmt = scoped_jobs(db, principal)
    if status is not None:
        stmt = stmt.where(ProcessingJob.status == status)
    if job_type is not None:
        stmt = stmt.where(ProcessingJob.job_type == job_type)
    if collection_id is not None:
        stmt = stmt.where(ProcessingJob.collection_id == collection_id)
    if document_id is not None:
        stmt = stmt.where(ProcessingJob.document_id == document_id)
    if cursor:
        ts, last_id = decode_cursor(cursor)
        stmt = stmt.where(or_(ProcessingJob.queued_at < ts,
                              (ProcessingJob.queued_at == ts) & (ProcessingJob.id < last_id)))
    rows = db.execute(stmt.order_by(ProcessingJob.queued_at.desc(), ProcessingJob.id.desc())
                      .limit(limit + 1)).all()
    page = rows[:limit]
    next_cursor = (encode_cursor(page[-1][0].queued_at, page[-1][0].id)
                   if len(rows) > limit else None)
    return JobPage(items=[job_out(j, f) for j, f in page], next_cursor=next_cursor)


@router.get("/{job_id}", response_model=JobDetail)
def get_job(
    job_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.JOB_READ)),
    db: Session = Depends(get_db),
) -> JobDetail:
    job, filename = _load(db, principal, job_id)
    return _detail(db, job, filename)


@router.post("/{job_id}/retry", response_model=JobOut)
def retry_job(
    job_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.JOB_MANAGE)),
    db: Session = Depends(get_db),
) -> JobOut:
    job, filename = _load(db, principal, job_id)
    try:
        manual_retry(db, job)
    except InvalidTransition as exc:
        raise ConflictError(code="INVALID_JOB_STATE",
                            message="Only failed or cancelled jobs can be retried.") from exc
    record_audit(db, action="job.retry", resource_type="job", resource_id=job.id,
                 principal=principal)
    db.commit()
    return job_out(job, filename)


@router.post("/{job_id}/cancel", response_model=JobOut)
def cancel_job(
    job_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.JOB_MANAGE)),
    db: Session = Depends(get_db),
) -> JobOut:
    job, filename = _load(db, principal, job_id)
    try:
        request_cancel(db, job)
    except InvalidTransition as exc:
        raise ConflictError(code="INVALID_JOB_STATE",
                            message="Only queued, waiting or running jobs can be cancelled.",
                            ) from exc
    record_audit(db, action="job.cancel", resource_type="job", resource_id=job.id,
                 principal=principal, metadata={"status": job.status.value})
    db.commit()
    return job_out(job, filename)
