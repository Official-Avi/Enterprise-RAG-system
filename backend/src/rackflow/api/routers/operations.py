"""Operations views: queue summary, worker health, processing metrics (tenant-scoped)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rackflow.auth.deps import require
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.db.models import (
    Chunk,
    Document,
    DocumentStatus,
    JobAttempt,
    JobStatus,
    PipelineStageRun,
    ProcessingJob,
    WorkerHeartbeat,
)
from rackflow.db.session import get_db
from rackflow.worker.main import HEARTBEAT_SECONDS

router = APIRouter(prefix="/operations", tags=["operations"])
STALE_AFTER = timedelta(seconds=HEARTBEAT_SECONDS * 3)
WINDOWS = {"1h": (3600, 300), "24h": (86400, 3600), "7d": (604800, 21600)}


class WorkerCounts(BaseModel):
    total: int
    healthy: int
    stale: int


class Summary(BaseModel):
    jobs: dict[str, int]
    queue_depth: int
    oldest_queued_age_seconds: int | None
    documents: dict[str, int]
    indexed_chunks: int
    workers: WorkerCounts
    generated_at: datetime


class WorkerOut(BaseModel):
    worker_id: str
    hostname: str
    status: str
    health: Literal["healthy", "stale", "stopped"]
    current_job_id: uuid.UUID | None
    jobs_succeeded: int
    jobs_failed: int
    started_at: datetime
    last_heartbeat_at: datetime
    version: str


class WorkerList(BaseModel):
    items: list[WorkerOut]


class Bucket(BaseModel):
    start: datetime
    succeeded: int
    failed: int


class Metrics(BaseModel):
    window_seconds: int
    buckets: list[Bucket]
    avg_job_duration_ms: int | None
    p95_job_duration_ms: int | None
    error_rate: float | None
    stage_durations_ms: dict[str, int]


def _health(w: WorkerHeartbeat, now: datetime) -> Literal["healthy", "stale", "stopped"]:
    if w.status == "stopped":
        return "stopped"
    return "healthy" if now - w.last_heartbeat_at <= STALE_AFTER else "stale"


@router.get("/summary", response_model=Summary)
def summary(
    principal: Principal = Depends(require(Permission.OPS_READ)),
    db: Session = Depends(get_db),
) -> Summary:
    now = datetime.now(UTC)
    tid = principal.tenant_id
    job_counts = dict(db.execute(
        select(ProcessingJob.status, func.count()).where(ProcessingJob.tenant_id == tid)
        .group_by(ProcessingJob.status)).all())
    jobs = {s.value: int(job_counts.get(s, 0)) for s in JobStatus}
    oldest = db.scalar(select(func.min(ProcessingJob.queued_at)).where(
        ProcessingJob.tenant_id == tid,
        ProcessingJob.status.in_([JobStatus.QUEUED, JobStatus.RETRY_WAIT])))
    doc_counts = dict(db.execute(
        select(Document.status, func.count()).where(Document.tenant_id == tid)
        .group_by(Document.status)).all())
    documents = {s.value: int(doc_counts.get(s, 0)) for s in DocumentStatus
                 if s != DocumentStatus.DELETED}
    chunks = db.scalar(select(func.count()).select_from(Chunk).join(
        Document, Document.current_version_id == Chunk.document_version_id).where(
        Chunk.tenant_id == tid, Document.status == DocumentStatus.INDEXED)) or 0
    workers = db.scalars(select(WorkerHeartbeat)).all()
    health = [_health(w, now) for w in workers]
    return Summary(
        jobs=jobs,
        queue_depth=jobs["queued"] + jobs["retry_wait"],
        oldest_queued_age_seconds=int((now - oldest).total_seconds()) if oldest else None,
        documents=documents,
        indexed_chunks=int(chunks),
        workers=WorkerCounts(total=sum(h != "stopped" for h in health),
                             healthy=health.count("healthy"), stale=health.count("stale")),
        generated_at=now,
    )


@router.get("/workers", response_model=WorkerList)
def workers(
    principal: Principal = Depends(require(Permission.OPS_READ)),
    db: Session = Depends(get_db),
) -> WorkerList:
    now = datetime.now(UTC)
    rows = db.scalars(select(WorkerHeartbeat).where(
        WorkerHeartbeat.last_heartbeat_at > now - timedelta(days=1))
        .order_by(WorkerHeartbeat.started_at.desc())).all()
    current_ids = [w.current_job_id for w in rows if w.current_job_id]
    own_jobs = set(db.scalars(select(ProcessingJob.id).where(
        ProcessingJob.id.in_(current_ids), ProcessingJob.tenant_id == principal.tenant_id)).all()
    ) if current_ids else set()
    return WorkerList(items=[
        WorkerOut(worker_id=w.worker_id, hostname=w.hostname, status=w.status,
                  health=_health(w, now),
                  current_job_id=w.current_job_id if w.current_job_id in own_jobs else None,
                  jobs_succeeded=w.jobs_succeeded, jobs_failed=w.jobs_failed,
                  started_at=w.started_at, last_heartbeat_at=w.last_heartbeat_at,
                  version=w.version)
        for w in rows
    ])


@router.get("/metrics", response_model=Metrics)
def metrics(
    window: Literal["1h", "24h", "7d"] = "1h",
    principal: Principal = Depends(require(Permission.OPS_READ)),
    db: Session = Depends(get_db),
) -> Metrics:
    seconds, bucket = WINDOWS[window]
    now = datetime.now(UTC)
    since = now - timedelta(seconds=seconds)
    tid = principal.tenant_id
    finished = db.execute(select(ProcessingJob.status, ProcessingJob.finished_at).where(
        ProcessingJob.tenant_id == tid, ProcessingJob.finished_at >= since,
        ProcessingJob.status.in_([JobStatus.SUCCEEDED, JobStatus.FAILED]))).all()
    n_buckets = seconds // bucket
    start0 = now - timedelta(seconds=n_buckets * bucket)
    buckets = [Bucket(start=start0 + timedelta(seconds=i * bucket), succeeded=0, failed=0)
               for i in range(n_buckets)]
    for status, ts in finished:
        if ts is None:
            continue
        idx = min(n_buckets - 1, max(0, int((ts - start0).total_seconds() // bucket)))
        if status == JobStatus.SUCCEEDED:
            buckets[idx].succeeded += 1
        else:
            buckets[idx].failed += 1

    durations = sorted(
        int((f - s).total_seconds() * 1000) for s, f in db.execute(
            select(JobAttempt.started_at, JobAttempt.finished_at).where(
                JobAttempt.tenant_id == tid, JobAttempt.finished_at >= since,
                JobAttempt.status == "succeeded")).all() if f is not None)
    total = len(finished)
    failed = sum(1 for s, _ in finished if s == JobStatus.FAILED)
    stage_rows = db.execute(
        select(PipelineStageRun.stage, func.avg(PipelineStageRun.duration_ms)).where(
            PipelineStageRun.tenant_id == tid, PipelineStageRun.started_at >= since,
            PipelineStageRun.status == "succeeded").group_by(PipelineStageRun.stage)).all()
    return Metrics(
        window_seconds=seconds,
        buckets=buckets,
        avg_job_duration_ms=int(sum(durations) / len(durations)) if durations else None,
        p95_job_duration_ms=durations[min(len(durations) - 1, int(0.95 * len(durations)))]
        if durations else None,
        error_rate=round(failed / total, 4) if total else None,
        stage_durations_ms={stage.value: int(avg) for stage, avg in stage_rows if avg is not None},
    )
