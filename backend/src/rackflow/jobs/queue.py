"""PostgreSQL-backed durable job queue (ADR-005).

Claiming uses `SELECT … FOR UPDATE SKIP LOCKED`, so concurrent workers never receive the same
job. A claimed job holds a lease that the worker renews while it runs; if the worker dies the
lease expires and another worker reclaims the job (the stale attempt is marked `abandoned`).
Outcome writes are guarded by (lease_owner, attempt_count), so a worker that lost its lease can
never overwrite the result of a newer attempt.
"""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session

from rackflow.core.config import get_settings
from rackflow.db.models import (
    Document,
    DocumentStatus,
    JobAttempt,
    JobStatus,
    JobType,
    ProcessingJob,
)

BACKOFF_BASE_SECONDS = 5.0
BACKOFF_CAP_SECONDS = 300.0


class InvalidTransition(Exception):
    """Requested state change is not allowed from the job's current state."""


@dataclass(frozen=True, slots=True)
class ClaimedJob:
    job_id: uuid.UUID
    tenant_id: uuid.UUID
    job_type: JobType
    attempt_number: int
    document_id: uuid.UUID | None
    payload: dict[str, Any]
    correlation_id: str | None


def backoff_seconds(attempt_number: int) -> float:
    """Exponential backoff with full jitter, never below one second."""
    ceiling = min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * 2 ** max(0, attempt_number - 1))
    return max(1.0, random.uniform(0, ceiling))  # noqa: S311 — jitter, not security


def _now() -> datetime:
    return datetime.now(UTC)


def _on_terminal(db: Session, job: ProcessingJob) -> None:
    """Propagate terminal job outcomes to the owning document."""
    if (job.job_type == JobType.INGEST_DOCUMENT and job.document_id
            and job.status in (JobStatus.FAILED, JobStatus.CANCELLED)):
        doc = db.get(Document, job.document_id)
        if doc is not None and doc.status in (DocumentStatus.QUEUED, DocumentStatus.PROCESSING):
            doc.status = DocumentStatus.FAILED


def _close_attempt(db: Session, job: ProcessingJob, attempt_number: int, status: str,
                   code: str | None = None, message: str | None = None) -> None:
    db.execute(
        update(JobAttempt)
        .where(JobAttempt.job_id == job.id, JobAttempt.attempt_number == attempt_number,
               JobAttempt.finished_at.is_(None))
        .values(status=status, finished_at=_now(), error_code=code, safe_error_message=message,
                stage=job.stage)
    )


def _terminal(db: Session, job: ProcessingJob, status: JobStatus, code: str | None = None,
              message: str | None = None) -> None:
    job.status = status
    job.finished_at = _now()
    job.lease_owner = None
    job.lease_expires_at = None
    if code is not None:
        job.error_code = code
        job.safe_error_message = message
    _on_terminal(db, job)


def claim_next(
    db: Session, worker_id: str, *, lease_seconds: int,
    job_types: list[JobType] | None = None,
) -> ClaimedJob | None:
    now = _now()
    claimable = or_(
        and_(ProcessingJob.status.in_([JobStatus.QUEUED, JobStatus.RETRY_WAIT]),
             ProcessingJob.available_at <= now),
        and_(ProcessingJob.status == JobStatus.RUNNING, ProcessingJob.lease_expires_at < now),
    )
    stmt = select(ProcessingJob).where(claimable)
    if job_types:
        stmt = stmt.where(ProcessingJob.job_type.in_(job_types))
    stmt = (stmt.order_by(ProcessingJob.priority, ProcessingJob.available_at)
            .limit(1).with_for_update(skip_locked=True))
    job = db.scalar(stmt)
    if job is None:
        db.commit()
        return None

    if job.status == JobStatus.RUNNING:  # lease expired: previous worker crashed or stalled
        _close_attempt(db, job, job.attempt_count, "abandoned", "LEASE_EXPIRED",
                       "The worker stopped responding; the job was reclaimed.")
        if job.cancel_requested:
            _terminal(db, job, JobStatus.CANCELLED)
            db.commit()
            return None
        if job.attempt_count >= job.max_attempts:
            _terminal(db, job, JobStatus.FAILED, "LEASE_EXPIRED",
                      "The worker stopped responding and no attempts remain.")
            db.commit()
            return None

    job.status = JobStatus.RUNNING
    job.lease_owner = worker_id
    job.lease_expires_at = now + timedelta(seconds=lease_seconds)
    job.started_at = job.started_at or now
    job.attempt_count += 1
    job.error_code = None
    job.safe_error_message = None
    db.add(JobAttempt(tenant_id=job.tenant_id, job_id=job.id, attempt_number=job.attempt_count,
                      worker_id=worker_id, status="running", started_at=now))
    claimed = ClaimedJob(job_id=job.id, tenant_id=job.tenant_id, job_type=job.job_type,
                         attempt_number=job.attempt_count, document_id=job.document_id,
                         payload=dict(job.payload or {}), correlation_id=job.correlation_id)
    db.commit()
    return claimed


def _owned(db: Session, claim: ClaimedJob, worker_id: str) -> ProcessingJob | None:
    job = db.scalar(select(ProcessingJob).where(ProcessingJob.id == claim.job_id).with_for_update())
    if (job is None or job.status != JobStatus.RUNNING or job.lease_owner != worker_id
            or job.attempt_count != claim.attempt_number):
        return None
    return job


def renew_lease(db: Session, claim: ClaimedJob, worker_id: str, lease_seconds: int) -> bool:
    result = db.execute(
        update(ProcessingJob)
        .where(ProcessingJob.id == claim.job_id, ProcessingJob.lease_owner == worker_id,
               ProcessingJob.attempt_count == claim.attempt_number,
               ProcessingJob.status == JobStatus.RUNNING)
        .values(lease_expires_at=_now() + timedelta(seconds=lease_seconds))
    )
    db.commit()
    return bool(getattr(result, "rowcount", 0))


def mark_succeeded(db: Session, claim: ClaimedJob, worker_id: str) -> bool:
    job = _owned(db, claim, worker_id)
    if job is None:
        db.rollback()
        return False
    _close_attempt(db, job, claim.attempt_number, "succeeded")
    _terminal(db, job, JobStatus.SUCCEEDED)
    job.error_code = job.safe_error_message = None
    db.commit()
    return True


def mark_failed(db: Session, claim: ClaimedJob, worker_id: str, *, code: str, message: str,
                retryable: bool) -> JobStatus | None:
    job = _owned(db, claim, worker_id)
    if job is None:
        db.rollback()
        return None
    _close_attempt(db, job, claim.attempt_number, "failed", code, message)
    if retryable and job.attempt_count < job.max_attempts and not job.cancel_requested:
        job.status = JobStatus.RETRY_WAIT
        job.available_at = _now() + timedelta(seconds=backoff_seconds(job.attempt_count))
        job.lease_owner = None
        job.lease_expires_at = None
        job.error_code, job.safe_error_message = code, message
    elif job.cancel_requested:
        _terminal(db, job, JobStatus.CANCELLED, code, message)
    else:
        _terminal(db, job, JobStatus.FAILED, code, message)
    status = job.status
    db.commit()
    return status


def mark_cancelled(db: Session, claim: ClaimedJob, worker_id: str) -> bool:
    job = _owned(db, claim, worker_id)
    if job is None:
        db.rollback()
        return False
    _close_attempt(db, job, claim.attempt_number, "cancelled", "JOB_CANCELLED",
                   "The job was cancelled.")
    _terminal(db, job, JobStatus.CANCELLED, "JOB_CANCELLED", "The job was cancelled.")
    db.commit()
    return True


def request_cancel(db: Session, job: ProcessingJob) -> ProcessingJob:
    if job.status in (JobStatus.QUEUED, JobStatus.RETRY_WAIT):
        _terminal(db, job, JobStatus.CANCELLED, "JOB_CANCELLED", "The job was cancelled.")
    elif job.status == JobStatus.RUNNING:
        job.cancel_requested = True  # best effort: honoured at the next stage boundary
    else:
        raise InvalidTransition(f"cannot cancel a {job.status.value} job")
    return job


def manual_retry(db: Session, job: ProcessingJob) -> ProcessingJob:
    """Re-queue a FAILED/CANCELLED job with a fresh attempt budget (history is preserved)."""
    if job.status not in (JobStatus.FAILED, JobStatus.CANCELLED):
        raise InvalidTransition(f"cannot retry a {job.status.value} job")
    job.status = JobStatus.QUEUED
    job.available_at = _now()
    job.finished_at = None
    job.cancel_requested = False
    job.max_attempts = job.attempt_count + get_settings().job_max_attempts
    job.error_code = job.safe_error_message = None
    if job.job_type == JobType.INGEST_DOCUMENT and job.document_id:
        doc = db.get(Document, job.document_id)
        if doc is not None and doc.status == DocumentStatus.FAILED:
            doc.status = DocumentStatus.QUEUED
    return job
