"""The context object every job handler receives (contract between the job runner and the
ingestion / indexing / evaluation handlers).

Handler signature:  def handler(ctx: JobContext) -> None
Handlers must be idempotent: a job can be delivered again after a crash or lease expiry.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from rackflow.db.models import PipelineStage, PipelineStageRun, ProcessingJob, StageStatus
from rackflow.jobs.errors import JobCancelled, JobError


@dataclass
class StageRecorder:
    details: dict[str, Any] = field(default_factory=dict)  # counts/sizes only — never text
    skipped: bool = False


@dataclass
class JobContext:
    db: Session
    job_id: uuid.UUID
    tenant_id: uuid.UUID
    document_id: uuid.UUID | None
    attempt_number: int
    worker_id: str
    correlation_id: str
    payload: dict[str, Any]
    heartbeat: Callable[[], None] = lambda: None  # runner extends the lease

    def check_cancelled(self) -> None:
        requested = self.db.scalar(
            select(ProcessingJob.cancel_requested).where(ProcessingJob.id == self.job_id)
        )
        if requested:
            raise JobCancelled()

    @contextmanager
    def stage(self, stage: PipelineStage) -> Iterator[StageRecorder]:
        """Record a pipeline stage run (FR-021). Commits before and after the stage."""
        self.check_cancelled()
        self.heartbeat()
        started = datetime.now(UTC)
        t0 = time.perf_counter()
        run = PipelineStageRun(
            tenant_id=self.tenant_id,
            job_id=self.job_id,
            attempt_number=self.attempt_number,
            document_id=self.document_id,
            stage=stage,
            status=StageStatus.RUNNING,
            started_at=started,
            details={},
        )
        self.db.add(run)
        self.db.execute(
            update(ProcessingJob).where(ProcessingJob.id == self.job_id).values(stage=stage.value)
        )
        self.db.commit()
        recorder = StageRecorder()
        try:
            yield recorder
        except BaseException as exc:
            self.db.rollback()
            run = self.db.merge(run)
            run.status = StageStatus.FAILED
            run.error_code = exc.code if isinstance(exc, JobError) else type(exc).__name__[:64]
            run.finished_at = datetime.now(UTC)
            run.duration_ms = int((time.perf_counter() - t0) * 1000)
            run.details = recorder.details
            self.db.commit()
            raise
        run.status = StageStatus.SKIPPED if recorder.skipped else StageStatus.SUCCEEDED
        run.finished_at = datetime.now(UTC)
        run.duration_ms = int((time.perf_counter() - t0) * 1000)
        run.details = recorder.details
        self.db.commit()
