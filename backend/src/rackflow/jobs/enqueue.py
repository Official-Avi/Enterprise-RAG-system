"""Transactional enqueue. Called inside the same DB transaction that creates the document, so a
job can never exist without its document or vice versa (outbox-safe, ARCHITECTURE §4.1)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.core.config import get_settings
from rackflow.core.logging import get_correlation_id
from rackflow.db.models import JobStatus, JobType, ProcessingJob


def enqueue_job(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    job_type: JobType,
    idempotency_key: str,
    document_id: uuid.UUID | None = None,
    collection_id: uuid.UUID | None = None,
    payload: dict[str, Any] | None = None,
    priority: int = 100,
    created_by: uuid.UUID | None = None,
    max_attempts: int | None = None,
) -> ProcessingJob:
    """Create a queued job; returns the existing job if the idempotency key was already used."""
    existing = db.scalar(
        select(ProcessingJob).where(ProcessingJob.idempotency_key == idempotency_key)
    )
    if existing is not None:
        return existing
    now = datetime.now(UTC)
    job = ProcessingJob(
        tenant_id=tenant_id,
        document_id=document_id,
        collection_id=collection_id,
        job_type=job_type,
        status=JobStatus.QUEUED,
        priority=priority,
        attempt_count=0,
        max_attempts=max_attempts or get_settings().job_max_attempts,
        idempotency_key=idempotency_key,
        payload=payload or {},
        queued_at=now,
        available_at=now,
        correlation_id=get_correlation_id(),
        created_by=created_by,
    )
    db.add(job)
    db.flush()
    return job
