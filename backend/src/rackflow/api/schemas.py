"""Response schemas shared by several routers (jobs, documents, operations)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from rackflow.db.models import JobAttempt, PipelineStageRun, ProcessingJob


class JobBrief(BaseModel):
    id: uuid.UUID
    job_type: str
    status: str
    stage: str | None
    attempt_count: int
    max_attempts: int
    error_code: str | None
    safe_error_message: str | None


class JobOut(JobBrief):
    document_id: uuid.UUID | None
    document_filename: str | None
    collection_id: uuid.UUID | None
    priority: int
    queued_at: datetime
    available_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    correlation_id: str | None
    cancel_requested: bool


class AttemptOut(BaseModel):
    attempt_number: int
    worker_id: str
    status: str
    stage: str | None
    started_at: datetime
    finished_at: datetime | None
    error_code: str | None
    safe_error_message: str | None


class StageRunOut(BaseModel):
    attempt_number: int
    stage: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None
    details: dict[str, Any]
    error_code: str | None


def job_brief(job: ProcessingJob) -> JobBrief:
    return JobBrief(id=job.id, job_type=job.job_type.value, status=job.status.value,
                    stage=job.stage, attempt_count=job.attempt_count,
                    max_attempts=job.max_attempts, error_code=job.error_code,
                    safe_error_message=job.safe_error_message)


def job_out(job: ProcessingJob, filename: str | None) -> JobOut:
    return JobOut(
        **job_brief(job).model_dump(), document_id=job.document_id, document_filename=filename,
        collection_id=job.collection_id, priority=job.priority, queued_at=job.queued_at,
        available_at=job.available_at, started_at=job.started_at, finished_at=job.finished_at,
        correlation_id=job.correlation_id, cancel_requested=job.cancel_requested,
    )


def attempt_out(a: JobAttempt) -> AttemptOut:
    return AttemptOut(attempt_number=a.attempt_number, worker_id=a.worker_id, status=a.status,
                      stage=a.stage, started_at=a.started_at, finished_at=a.finished_at,
                      error_code=a.error_code, safe_error_message=a.safe_error_message)


def stage_out(s: PipelineStageRun) -> StageRunOut:
    return StageRunOut(attempt_number=s.attempt_number, stage=s.stage.value,
                       status=s.status.value, started_at=s.started_at,
                       finished_at=s.finished_at, duration_ms=s.duration_ms,
                       details=dict(s.details or {}), error_code=s.error_code)
