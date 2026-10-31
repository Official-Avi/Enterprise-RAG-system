"""Durable queue semantics (ADR-005): claiming, retries/backoff, permanent failure, cancellation,
lease expiry + reclaim, safe errors, manual retry, and a real worker-process crash."""

from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from rackflow.cli import ensure_tenant
from rackflow.db.models import (
    Collection,
    Document,
    DocumentStatus,
    JobAttempt,
    JobStatus,
    JobType,
    ProcessingJob,
)
from rackflow.db.session import get_sessionmaker, session_scope
from rackflow.jobs import queue, registry
from rackflow.jobs.context import JobContext
from rackflow.jobs.enqueue import enqueue_job
from rackflow.jobs.errors import (
    DEPENDENCY_MESSAGE,
    DEPENDENCY_UNAVAILABLE,
    PermanentJobError,
    RetryableJobError,
    is_dependency_failure,
)
from rackflow.jobs.runner import run_claimed_job
from tests.conftest import TEST_DB

pytestmark = pytest.mark.integration
BACKEND = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _handlers() -> Iterator[None]:
    yield
    registry.clear_overrides()


@pytest.fixture()
def tenant_id() -> uuid.UUID:
    with session_scope() as s:
        return ensure_tenant(s, "acme", "Acme").id


def _enqueue(tenant_id: uuid.UUID, job_type: JobType = JobType.EVALUATION_RUN,
             max_attempts: int = 3, document_id: uuid.UUID | None = None) -> uuid.UUID:
    with session_scope() as s:
        job = enqueue_job(s, tenant_id=tenant_id, job_type=job_type,
                          idempotency_key=f"test:{uuid.uuid4()}", max_attempts=max_attempts,
                          document_id=document_id, payload={})
        return job.id


def _claim(worker: str = "w1") -> queue.ClaimedJob | None:
    with get_sessionmaker()() as s:
        return queue.claim_next(s, worker, lease_seconds=60)


def _job(db: Session, job_id: uuid.UUID) -> ProcessingJob:
    db.expire_all()
    job = db.get(ProcessingJob, job_id)
    assert job is not None
    return job


def _run_next(worker: str = "w1") -> str | None:
    claim = _claim(worker)
    return run_claimed_job(claim, worker, lease_seconds=60) if claim else None


def test_enqueue_is_idempotent(tenant_id: uuid.UUID) -> None:
    with session_scope() as s:
        a = enqueue_job(s, tenant_id=tenant_id, job_type=JobType.EVALUATION_RUN,
                        idempotency_key="same-key")
        b = enqueue_job(s, tenant_id=tenant_id, job_type=JobType.EVALUATION_RUN,
                        idempotency_key="same-key")
        assert a.id == b.id


def test_concurrent_claimers_never_share_a_job(tenant_id: uuid.UUID) -> None:
    job_ids = {_enqueue(tenant_id) for _ in range(3)}
    results: list[uuid.UUID] = []
    lock = threading.Lock()

    def claimer(i: int) -> None:
        claim = _claim(f"w{i}")
        if claim:
            with lock:
                results.append(claim.job_id)

    threads = [threading.Thread(target=claimer, args=(i,)) for i in range(10)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == sorted(job_ids)  # each job claimed exactly once


def test_success(tenant_id: uuid.UUID, db: Session) -> None:
    registry.register_handler(JobType.EVALUATION_RUN, lambda ctx: None)
    job_id = _enqueue(tenant_id)
    assert _run_next() == "succeeded"
    job = _job(db, job_id)
    assert job.status == JobStatus.SUCCEEDED and job.attempt_count == 1 and job.finished_at


def test_retryable_error_backs_off_then_exhausts(tenant_id: uuid.UUID, db: Session) -> None:
    def flaky(ctx: JobContext) -> None:
        raise RetryableJobError("DEPENDENCY_DOWN", "A dependency is unavailable.")

    registry.register_handler(JobType.EVALUATION_RUN, flaky)
    job_id = _enqueue(tenant_id, max_attempts=3)
    assert _run_next() == "retry_wait"
    job = _job(db, job_id)
    assert job.available_at > datetime.now(UTC)
    assert job.error_code == "DEPENDENCY_DOWN"
    assert _claim() is None  # not claimable during backoff

    for expected in ("retry_wait", "failed"):
        db.execute(update(ProcessingJob).where(ProcessingJob.id == job_id)
                   .values(available_at=datetime.now(UTC) - timedelta(seconds=1)))
        db.commit()
        assert _run_next() == expected
    job = _job(db, job_id)
    assert job.status == JobStatus.FAILED and job.attempt_count == 3
    attempts = db.scalars(select(JobAttempt).where(JobAttempt.job_id == job_id)).all()
    assert [a.status for a in sorted(attempts, key=lambda a: a.attempt_number)] == ["failed"] * 3


def test_backoff_is_bounded_and_jittered() -> None:
    values = [queue.backoff_seconds(n) for n in range(1, 20) for _ in range(5)]
    assert all(1.0 <= v <= queue.BACKOFF_CAP_SECONDS for v in values)
    assert len({round(v, 3) for v in values}) > 10


def test_permanent_error_fails_once(tenant_id: uuid.UUID, db: Session) -> None:
    def bad(ctx: JobContext) -> None:
        raise PermanentJobError("CORRUPT_FILE", "The file is corrupt.")

    registry.register_handler(JobType.EVALUATION_RUN, bad)
    job_id = _enqueue(tenant_id, max_attempts=5)
    assert _run_next() == "failed"
    job = _job(db, job_id)
    assert job.attempt_count == 1 and job.safe_error_message == "The file is corrupt."


def test_unknown_exception_text_never_leaks(tenant_id: uuid.UUID, db: Session) -> None:
    def leaky(ctx: JobContext) -> None:
        raise RuntimeError("SECRET DOCUMENT CONTENT /home/x/private.pdf")

    registry.register_handler(JobType.EVALUATION_RUN, leaky)
    job_id = _enqueue(tenant_id, max_attempts=1)
    _run_next()
    job = _job(db, job_id)
    assert job.status == JobStatus.FAILED and job.error_code == "INTERNAL_ERROR"
    assert "SECRET" not in (job.safe_error_message or "")


def _dll_error() -> OSError:
    exc = OSError("A dynamic link library (DLL) initialization routine failed")
    exc.winerror = 1114  # what Windows reports; set explicitly so the test also runs on POSIX
    return exc


@pytest.mark.parametrize("make_exc", [
    lambda: ImportError("DLL load failed while importing _state", name="onnxruntime"),
    lambda: ModuleNotFoundError("No module named 'fastembed'", name="fastembed"),
    _dll_error,
])
def test_dependency_failure_is_not_retried(tenant_id: uuid.UUID, db: Session,
                                           make_exc: Callable[[], BaseException]) -> None:
    """BUG-03: a library that cannot load fails the same way on every attempt; fail it once with
    a safe, actionable message instead of four INTERNAL_ERROR retries."""
    def broken(ctx: JobContext) -> None:
        raise make_exc()

    registry.register_handler(JobType.EVALUATION_RUN, broken)
    job_id = _enqueue(tenant_id, max_attempts=4)
    assert _run_next() == "failed"
    job = _job(db, job_id)
    assert job.attempt_count == 1 and job.error_code == DEPENDENCY_UNAVAILABLE
    assert job.safe_error_message == DEPENDENCY_MESSAGE
    assert "onnxruntime" not in job.safe_error_message and "DLL" not in job.safe_error_message


def test_dependency_failure_classification() -> None:
    try:
        try:
            raise ImportError("x", name="onnxruntime")
        except ImportError as inner:
            raise RuntimeError("wrapped") from inner
    except RuntimeError as wrapped:
        assert is_dependency_failure(wrapped)  # found through the exception chain
    assert is_dependency_failure(_dll_error())
    # Ordinary OSErrors are transient and must stay retryable.
    for transient in (ConnectionRefusedError(), TimeoutError(), FileNotFoundError("x"),
                      OSError("disk busy"), RuntimeError("boom")):
        assert not is_dependency_failure(transient)


def test_cancel_queued_and_running(tenant_id: uuid.UUID, db: Session) -> None:
    queued_id = _enqueue(tenant_id)
    queue.request_cancel(db, _job(db, queued_id))
    db.commit()
    assert _job(db, queued_id).status == JobStatus.CANCELLED

    def cooperative(ctx: JobContext) -> None:
        with session_scope() as s:  # an operator cancels while the job runs
            queue.request_cancel(s, s.get(ProcessingJob, ctx.job_id))  # type: ignore[arg-type]
        ctx.check_cancelled()

    registry.register_handler(JobType.EVALUATION_RUN, cooperative)
    running_id = _enqueue(tenant_id)
    assert _run_next() == "cancelled"
    assert _job(db, running_id).status == JobStatus.CANCELLED
    with pytest.raises(queue.InvalidTransition):
        queue.request_cancel(db, _job(db, running_id))


def test_lease_expiry_reclaim_and_stale_owner_cannot_finish(tenant_id: uuid.UUID,
                                                            db: Session) -> None:
    job_id = _enqueue(tenant_id)
    stale = _claim("crashed-worker")
    assert stale is not None
    db.execute(update(ProcessingJob).where(ProcessingJob.id == job_id)
               .values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    db.commit()
    fresh = _claim("healthy-worker")
    assert fresh is not None and fresh.attempt_number == 2
    with get_sessionmaker()() as s:
        assert queue.mark_succeeded(s, stale, "crashed-worker") is False
    with get_sessionmaker()() as s:
        assert queue.mark_succeeded(s, fresh, "healthy-worker") is True
    attempts = {a.attempt_number: a.status for a in db.scalars(
        select(JobAttempt).where(JobAttempt.job_id == job_id)).all()}
    assert attempts == {1: "abandoned", 2: "succeeded"}


def test_ingest_terminal_failure_marks_document_failed_and_manual_retry(
        tenant_id: uuid.UUID, db: Session) -> None:
    with session_scope() as s:
        col = Collection(tenant_id=tenant_id, name="c")
        s.add(col)
        s.flush()
        doc = Document(tenant_id=tenant_id, collection_id=col.id, filename="a.txt",
                       file_type="txt", mime_type="text/plain", size_bytes=1, content_hash="0" * 64,
                       storage_key="tenants/x/documents/y/original", warnings=[])
        s.add(doc)
        s.flush()
        doc_id = doc.id

    def bad(ctx: JobContext) -> None:
        raise PermanentJobError("NO_EXTRACTABLE_TEXT", "No usable text.")

    registry.register_handler(JobType.INGEST_DOCUMENT, bad)
    job_id = _enqueue(tenant_id, JobType.INGEST_DOCUMENT, document_id=doc_id)
    _run_next()
    db.expire_all()
    assert db.get(Document, doc_id).status == DocumentStatus.FAILED  # type: ignore[union-attr]

    job = _job(db, job_id)
    queue.manual_retry(db, job)
    db.commit()
    job = _job(db, job_id)
    assert job.status == JobStatus.QUEUED and job.max_attempts > job.attempt_count
    assert db.get(Document, doc_id).status == DocumentStatus.QUEUED  # type: ignore[union-attr]
    with pytest.raises(queue.InvalidTransition):
        queue.manual_retry(db, job)


def test_real_worker_crash_is_recovered(tenant_id: uuid.UUID, db: Session) -> None:
    """ADR-005 acceptance: kill a worker process mid-job; another worker completes it once."""
    job_id = _enqueue(tenant_id, max_attempts=3)
    env = {**os.environ, "DATABASE_URL": TEST_DB, "APP_ENV": "test", "JOB_LEASE_SECONDS": "10",
           "WORKER_POLL_INTERVAL_SECONDS": "0.5",
           "RACKFLOW_WORKER_PLUGINS": "tests.jobs.crash_plugin"}
    cmd = [sys.executable, "-m", "rackflow.worker.main", "--max-jobs", "1"]
    first = subprocess.Popen(cmd, cwd=BACKEND, env=env, stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
    try:
        deadline = time.time() + 60
        while time.time() < deadline and _job(db, job_id).status != JobStatus.RUNNING:
            time.sleep(0.3)
        assert _job(db, job_id).status == JobStatus.RUNNING
        first.kill()  # hard crash: no cleanup, lease is left behind
        first.wait(timeout=10)
    finally:
        if first.poll() is None:
            first.kill()

    second = subprocess.run(cmd, cwd=BACKEND, env=env, timeout=90, capture_output=True)
    assert second.returncode == 0, second.stderr[-2000:]
    job = _job(db, job_id)
    assert job.status == JobStatus.SUCCEEDED and job.attempt_count == 2
    attempts = {a.attempt_number: a.status for a in db.scalars(
        select(JobAttempt).where(JobAttempt.job_id == job_id)).all()}
    assert attempts == {1: "abandoned", 2: "succeeded"}
