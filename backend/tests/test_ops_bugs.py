"""Regression tests for operations bugs: worker counts (BUG-09), evaluation runs with errors
(BUG-10), the worker surviving a database outage, and delete jobs that give up."""

from __future__ import annotations

import contextlib
import os
import socket
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from rackflow.cli import ensure_tenant
from rackflow.core.errors import AppError
from rackflow.db.models import (
    Document,
    DocumentStatus,
    JobStatus,
    JobType,
    ProcessingJob,
    Role,
    WorkerHeartbeat,
)
from rackflow.db.session import get_sessionmaker, session_scope
from rackflow.evaluation import runner as eval_runner
from rackflow.jobs import queue, registry
from rackflow.jobs import runner as job_runner
from rackflow.jobs.context import JobContext
from rackflow.jobs.enqueue import enqueue_job
from rackflow.jobs.errors import (
    DATABASE_UNAVAILABLE,
    PermanentJobError,
    is_database_outage,
)
from rackflow.worker import main as worker_main
from tests.conftest import TEST_DB, Actor, Factory
from tests.ingestion.test_pipeline import make_collection, run_worker, upload

pytestmark = pytest.mark.integration
BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture(autouse=True)
def _handlers() -> Iterator[None]:
    yield
    registry.clear_overrides()


def _outage() -> OperationalError:
    return OperationalError("SELECT 1", {}, Exception("connection refused"))


def _next_outcome(worker: str = "w1", lease_seconds: int = 60) -> str | None:
    with get_sessionmaker()() as s:
        claim = queue.claim_next(s, worker, lease_seconds=lease_seconds)
    return job_runner.run_claimed_job(claim, worker, lease_seconds=lease_seconds) if claim else None


def _reload(db: Session, model: Any, row_id: uuid.UUID) -> Any:
    db.expire_all()
    row = db.get(model, row_id)
    assert row is not None
    return row


# ---------------------------------------------------------------- BUG-09: worker counts


def _heartbeat(worker_id: str, age: timedelta, status: str = "idle") -> WorkerHeartbeat:
    now = datetime.now(UTC)
    return WorkerHeartbeat(worker_id=worker_id, hostname="h", pid=1, status=status,
                           current_job_id=None, jobs_succeeded=0, jobs_failed=0, started_at=now,
                           last_heartbeat_at=now - age, version="t", capabilities={})


def test_summary_counts_the_workers_the_list_shows(client: TestClient, factory: Factory) -> None:
    op = factory.actor(Role.OPERATOR)
    with session_scope() as s:
        s.add_all([
            _heartbeat("live", timedelta(seconds=1), "busy"),
            _heartbeat("just-stale", timedelta(minutes=2)),
            _heartbeat("crashed-earlier", timedelta(minutes=30)),
            _heartbeat("exited-cleanly", timedelta(hours=1), "stopped"),
            _heartbeat("days-old-1", timedelta(days=2)),
            _heartbeat("days-old-2", timedelta(days=9)),
        ])
    listed = {w["worker_id"]: w["health"] for w in client.get(
        "/api/v1/operations/workers", headers=op.headers).json()["items"]}
    assert listed == {"live": "healthy", "just-stale": "stale", "crashed-earlier": "stopped",
                      "exited-cleanly": "stopped"}
    # The Racks page words each worker the same way, within its own one-hour window.
    racks = {p["worker_id"]: p["health"] for p in client.get(
        "/api/v1/infrastructure/overview", headers=op.headers).json()["platform_processes"]}
    assert racks == {"live": "healthy", "just-stale": "stale", "crashed-earlier": "stopped"}

    counts = client.get("/api/v1/operations/summary", headers=op.headers).json()["workers"]
    assert counts == {
        "total": sum(h != "stopped" for h in listed.values()),
        "healthy": sum(h == "healthy" for h in listed.values()),
        "stale": sum(h == "stale" for h in listed.values()),
    }
    assert counts == {"total": 2, "healthy": 1, "stale": 1}


# --------------------------------------------------- BUG-10: evaluation runs with errors


def _good_answer() -> SimpleNamespace:
    return SimpleNamespace(sources=[], citations=[], answer="An answer.",
                           evidence_status="supported", latency_ms=5)


def _run_evaluation(client: TestClient, actor: Actor,
                    answer: Callable[..., Any], monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setattr(eval_runner, "answer_question", answer)
    collection = make_collection(client, actor, f"Eval {uuid.uuid4().hex[:6]}")
    created = client.post("/api/v1/evaluation/runs", headers=actor.headers,
                          json={"dataset_version": "v1", "collection_ids": [collection]})
    assert created.status_code == 202, created.text
    run_worker()
    detail = client.get(f"/api/v1/evaluation/runs/{created.json()['id']}", headers=actor.headers)
    assert detail.status_code == 200
    body: dict[str, Any] = detail.json()
    return body


def test_run_with_every_question_errored_is_not_completed(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    def down(*_: Any, **__: Any) -> Any:
        raise AppError("Search is down.", code="SEARCH_UNAVAILABLE", status_code=503)

    run = _run_evaluation(client, factory.actor(Role.ORG_ADMIN), down, monkeypatch)
    assert run["status"] == "completed_with_errors"
    assert run["metrics"]["errors"] == run["metrics"]["questions"] > 0
    assert run["finished_at"] is not None


def test_run_with_one_question_errored_is_not_completed(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"n": 0}

    def one_fails(*_: Any, **__: Any) -> Any:
        calls["n"] += 1
        if calls["n"] == 1:
            raise AppError("Search is down.", code="SEARCH_UNAVAILABLE", status_code=503)
        return _good_answer()

    run = _run_evaluation(client, factory.actor(Role.ORG_ADMIN), one_fails, monkeypatch)
    assert run["status"] == "completed_with_errors" and run["metrics"]["errors"] == 1


def test_run_without_errors_is_completed(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    run = _run_evaluation(client, factory.actor(Role.ORG_ADMIN),
                          lambda *_, **__: _good_answer(), monkeypatch)
    assert run["status"] == "completed" and run["metrics"]["errors"] == 0


# ------------------------------------------------------------- worker: database outage


def test_outage_classification() -> None:
    assert is_database_outage(_outage())
    assert not is_database_outage(ProgrammingError("SELECT", {}, Exception("no such table")))
    assert not is_database_outage(IntegrityError("INSERT", {}, Exception("duplicate")))
    assert not is_database_outage(RuntimeError("boom"))


def test_outage_delay_is_bounded() -> None:
    delays = [worker_main.outage_delay(n) for n in range(1, 500)]
    assert delays[0] == worker_main.OUTAGE_RETRY_BASE_SECONDS and delays[1] > delays[0]
    assert max(delays) == worker_main.OUTAGE_RETRY_MAX_SECONDS


@pytest.fixture()
def tenant_id() -> uuid.UUID:
    with session_scope() as s:
        return ensure_tenant(s, "acme", "Acme").id


def _enqueue(tenant_id: uuid.UUID, payload: dict[str, Any] | None = None) -> uuid.UUID:
    with session_scope() as s:
        job = enqueue_job(s, tenant_id=tenant_id, job_type=JobType.EVALUATION_RUN,
                          idempotency_key=f"ops-api:{uuid.uuid4()}", payload=payload or {})
        return job.id


def test_outcome_write_waits_out_an_outage(
        tenant_id: uuid.UUID, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    registry.register_handler(JobType.EVALUATION_RUN, lambda ctx: None)
    job_id = _enqueue(tenant_id)
    real = queue.mark_succeeded
    failures = iter([_outage(), _outage()])

    def flaky(*args: Any, **kwargs: Any) -> bool:
        for exc in failures:
            raise exc
        return real(*args, **kwargs)

    monkeypatch.setattr(job_runner.queue, "mark_succeeded", flaky)
    monkeypatch.setattr(job_runner.time, "sleep", lambda _: None)
    assert _next_outcome() == "succeeded"
    job = _reload(db, ProcessingJob, job_id)
    assert job.status == JobStatus.SUCCEEDED and job.attempt_count == 1


def test_outcome_lost_to_a_long_outage_is_reclaimed(
        tenant_id: uuid.UUID, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    registry.register_handler(JobType.EVALUATION_RUN, lambda ctx: None)
    job_id = _enqueue(tenant_id)

    def down(*_: Any, **__: Any) -> bool:
        raise _outage()

    with monkeypatch.context() as patch:
        patch.setattr(job_runner.queue, "mark_succeeded", down)
        assert _next_outcome(lease_seconds=0) == job_runner.DB_UNAVAILABLE
    assert _reload(db, ProcessingJob, job_id).status == JobStatus.RUNNING

    db.execute(update(ProcessingJob).where(ProcessingJob.id == job_id)
               .values(lease_expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    db.commit()
    assert _next_outcome("w2") == "succeeded"
    job = _reload(db, ProcessingJob, job_id)
    assert job.status == JobStatus.SUCCEEDED and job.attempt_count == 2


def test_outage_inside_a_handler_is_retried_with_a_safe_code(
        tenant_id: uuid.UUID, db: Session) -> None:
    def handler(ctx: JobContext) -> None:
        raise _outage()

    registry.register_handler(JobType.EVALUATION_RUN, handler)
    job_id = _enqueue(tenant_id)
    assert _next_outcome() == "retry_wait"
    job = _reload(db, ProcessingJob, job_id)
    assert job.error_code == DATABASE_UNAVAILABLE
    assert "connection refused" not in (job.safe_error_message or "")


def test_lease_renewal_outage_does_not_fail_the_job(
        tenant_id: uuid.UUID, db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(ctx: JobContext) -> None:
        ctx.heartbeat()

    def down(*_: Any, **__: Any) -> bool:
        raise _outage()

    registry.register_handler(JobType.EVALUATION_RUN, handler)
    job_id = _enqueue(tenant_id)
    monkeypatch.setattr(job_runner.queue, "renew_lease", down)
    assert _next_outcome(lease_seconds=0) == "succeeded"  # 0 forces the renewal on every call
    assert _reload(db, ProcessingJob, job_id).status == JobStatus.SUCCEEDED


def _one_shot_claim_raises(monkeypatch: pytest.MonkeyPatch, exc: Exception,
                           argv: list[str]) -> None:
    def down(*_: Any, **__: Any) -> None:
        raise exc

    monkeypatch.setattr(worker_main.queue, "claim_next", down)
    with pytest.raises(type(exc)):
        worker_main.main(argv)


def test_one_shot_runs_still_report_an_outage(tenant_id: uuid.UUID,
                                              monkeypatch: pytest.MonkeyPatch) -> None:
    _one_shot_claim_raises(monkeypatch, _outage(), ["--once"])
    _one_shot_claim_raises(monkeypatch, _outage(), ["--exit-when-idle"])


def test_worker_still_dies_on_a_schema_error(tenant_id: uuid.UUID,
                                             monkeypatch: pytest.MonkeyPatch) -> None:
    _one_shot_claim_raises(monkeypatch, ProgrammingError("SELECT", {}, Exception("no table")),
                           ["--max-jobs", "1"])


class _SwitchableProxy:
    """A TCP forwarder to the real test PostgreSQL. Taking it down refuses new connections and
    cuts open ones, which is what a worker sees in an outage, without stopping the shared server
    other test runs and the live stack depend on."""

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = int(probe.getsockname()[1])
        self.listener: socket.socket | None = None
        self.connections: list[socket.socket] = []
        self.lock = threading.Lock()

    def up(self) -> None:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", self.port))
        listener.listen(32)
        self.listener = listener
        threading.Thread(target=self._accept, args=(listener,), daemon=True).start()

    def down(self) -> None:
        if self.listener is not None:
            self.listener.close()
            self.listener = None
        with self.lock:
            for conn in self.connections:
                with contextlib.suppress(OSError):
                    conn.shutdown(socket.SHUT_RDWR)
                conn.close()
            self.connections.clear()

    def _accept(self, listener: socket.socket) -> None:
        while True:
            try:
                client, _ = listener.accept()
                server = socket.create_connection(self.target, timeout=5)
            except OSError:
                return
            server.settimeout(None)
            with self.lock:
                self.connections += [client, server]
            for src, dst in ((client, server), (server, client)):
                threading.Thread(target=self._pump, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass


def _wait_for(check: Callable[[], bool], what: str, timeout: float = 45.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if check():
            return
        time.sleep(0.2)
    raise AssertionError(f"timed out waiting for {what}")


def test_real_worker_survives_database_outages(tenant_id: uuid.UUID, db: Session) -> None:
    """A real worker process through a proxy that can cut it off from PostgreSQL: down at start,
    down while a job finishes, and down while idle. It keeps running and loses no result."""
    url = make_url(TEST_DB)
    proxy = _SwitchableProxy(url.host or "127.0.0.1", url.port or 5432)
    via_proxy = url.set(host="127.0.0.1", port=proxy.port).render_as_string(hide_password=False)
    env = {**os.environ, "DATABASE_URL": via_proxy, "APP_ENV": "test",
           "JOB_LEASE_SECONDS": "60", "WORKER_POLL_INTERVAL_SECONDS": "0.2",
           "RACKFLOW_WORKER_PLUGINS": "tests.jobs.outage_plugin"}

    def status(job_id: uuid.UUID) -> JobStatus:
        return _reload(db, ProcessingJob, job_id).status

    worker = subprocess.Popen(
        [sys.executable, "-m", "rackflow.worker.main", "--max-jobs", "2"], cwd=BACKEND, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        # 1. PostgreSQL is out when the worker starts.
        time.sleep(4)
        assert worker.poll() is None, "worker exited during a startup outage"
        proxy.up()

        # 2. PostgreSQL goes out while a job runs, and returns after the handler has finished.
        first = _enqueue(tenant_id, {"sleep_seconds": 3})
        _wait_for(lambda: status(first) == JobStatus.RUNNING, "the first job to start")
        proxy.down()
        time.sleep(5)
        assert worker.poll() is None, "worker exited when the outcome write failed"
        assert status(first) == JobStatus.RUNNING
        proxy.up()
        _wait_for(lambda: status(first) == JobStatus.SUCCEEDED, "the first job's outcome")
        assert _reload(db, ProcessingJob, first).attempt_count == 1  # not run a second time

        # 3. PostgreSQL goes out while the worker is idle.
        proxy.down()
        time.sleep(3)
        assert worker.poll() is None, "worker exited during an idle outage"
        second = _enqueue(tenant_id)
        proxy.up()
        _wait_for(lambda: status(second) == JobStatus.SUCCEEDED, "the job queued in the outage")
        assert worker.wait(timeout=30) == 0
    finally:
        if worker.poll() is None:
            worker.kill()
            worker.wait(timeout=10)
        proxy.down()


# ----------------------------------------------------------- delete jobs that give up


def _fail_deletes() -> None:
    def bad(ctx: JobContext) -> None:
        raise PermanentJobError("STORAGE_UNAVAILABLE", "File storage is unavailable.")

    registry.register_handler(JobType.DELETE_DOCUMENT, bad)


def _request_delete(client: TestClient, actor: Actor, content: bytes = b"# A\n\nSome text."
                    ) -> tuple[str, uuid.UUID, str]:
    cid = make_collection(client, actor, f"Del {uuid.uuid4().hex[:6]}")
    doc_id = upload(client, actor, cid, [("del.md", content)])[0]["document_id"]
    resp = client.delete(f"/api/v1/documents/{doc_id}", headers=actor.headers)
    assert resp.status_code == 202, resp.text
    return doc_id, uuid.UUID(resp.json()["job_id"]), cid


def test_failed_delete_does_not_leave_the_document_deleting(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    _fail_deletes()
    doc_id, job_id, _ = _request_delete(client, eng)
    assert client.get(f"/api/v1/documents/{doc_id}",
                      headers=eng.headers).json()["status"] == "deleting"

    assert _next_outcome() == "failed"
    assert _reload(db, ProcessingJob, job_id).status == JobStatus.FAILED
    doc = _reload(db, Document, uuid.UUID(doc_id))
    assert doc.status == DocumentStatus.FAILED and doc.deleted_at is None
    assert client.get(f"/api/v1/documents/{doc_id}",
                      headers=eng.headers).json()["status"] == "failed"


def test_delete_out_of_attempts_after_a_crash_also_restores(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    doc_id, job_id, _ = _request_delete(client, eng)
    with get_sessionmaker()() as s:
        assert queue.claim_next(s, "crashed", lease_seconds=60) is not None
    db.execute(update(ProcessingJob).where(ProcessingJob.id == job_id).values(
        lease_expires_at=datetime.now(UTC) - timedelta(seconds=1), max_attempts=1))
    db.commit()
    assert _next_outcome() is None  # this claim closes the expired job as out of attempts
    assert _reload(db, ProcessingJob, job_id).error_code == "LEASE_EXPIRED"
    assert _reload(db, Document, uuid.UUID(doc_id)).status == DocumentStatus.FAILED


def test_cancelled_delete_restores_the_document(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    op = factory.actor(Role.OPERATOR)
    doc_id, job_id, _ = _request_delete(client, eng)
    resp = client.post(f"/api/v1/jobs/{job_id}/cancel", headers=op.headers)
    assert resp.status_code == 200 and resp.json()["status"] == "cancelled"
    doc = _reload(db, Document, uuid.UUID(doc_id))
    assert doc.status == DocumentStatus.FAILED and doc.deleted_at is None


def test_copy_uploaded_during_the_delete_keeps_the_dedup_slot(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    _fail_deletes()
    content = b"# Copy\n\nThe same bytes uploaded twice."
    doc_id, _, cid = _request_delete(client, eng, content)
    again = upload(client, eng, cid, [("del.md", content)])[0]
    assert again["document_id"] != doc_id

    assert _next_outcome() == "failed"  # delete runs first; the unique index must not break it
    doc = _reload(db, Document, uuid.UUID(doc_id))
    assert doc.status == DocumentStatus.FAILED and doc.deleted_at is not None
    live = _reload(db, Document, uuid.UUID(again["document_id"]))
    assert live.status != DocumentStatus.FAILED and live.deleted_at is None
    # Indexing this row again would make a document retrieval hides for good.
    retry = client.post(f"/api/v1/documents/{doc_id}/retry", headers=eng.headers)
    assert retry.status_code == 409, retry.text
    assert retry.json()["error"]["code"] == "NOT_RETRYABLE"


@pytest.mark.qdrant
def test_deleting_again_after_a_failure_really_deletes(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    _fail_deletes()
    doc_id, job_id, _ = _request_delete(client, eng)
    assert _next_outcome() == "failed"
    registry.clear_overrides()

    resp = client.delete(f"/api/v1/documents/{doc_id}", headers=eng.headers)
    assert resp.status_code == 202, resp.text
    assert uuid.UUID(resp.json()["job_id"]) == job_id  # same job, back in the queue
    assert _reload(db, ProcessingJob, job_id).status == JobStatus.QUEUED
    assert _reload(db, Document, uuid.UUID(doc_id)).status == DocumentStatus.DELETING

    assert _next_outcome() == "succeeded"
    assert _reload(db, Document, uuid.UUID(doc_id)).status == DocumentStatus.DELETED


@pytest.mark.qdrant
def test_job_retry_of_a_failed_delete_finishes_it(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    op = factory.actor(Role.OPERATOR)
    _fail_deletes()
    doc_id, job_id, _ = _request_delete(client, eng)
    assert _next_outcome() == "failed"
    registry.clear_overrides()

    resp = client.post(f"/api/v1/jobs/{job_id}/retry", headers=op.headers)
    assert resp.status_code == 200, resp.text
    doc = _reload(db, Document, uuid.UUID(doc_id))
    assert doc.status == DocumentStatus.DELETING and doc.deleted_at is not None
    assert _next_outcome() == "succeeded"
    assert _reload(db, Document, uuid.UUID(doc_id)).status == DocumentStatus.DELETED


def test_stuck_deleting_document_from_before_this_fix_can_be_recovered(
        client: TestClient, factory: Factory, db: Session) -> None:
    """Rows already stuck have a failed job and status `deleting`: job retry must accept them."""
    eng = factory.actor(Role.ENGINEER)
    doc_id, job_id, _ = _request_delete(client, eng)
    job = _reload(db, ProcessingJob, job_id)
    job.status = JobStatus.FAILED  # as the old code left it, with _on_terminal doing nothing
    db.commit()
    queue.manual_retry(db, _reload(db, ProcessingJob, job_id))
    db.commit()
    assert _reload(db, ProcessingJob, job_id).status == JobStatus.QUEUED
    assert _reload(db, Document, uuid.UUID(doc_id)).status == DocumentStatus.DELETING


def test_old_delete_job_cannot_delete_a_document_that_came_back(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    _fail_deletes()
    doc_id, job_id, _ = _request_delete(client, eng)
    assert _next_outcome() == "failed"
    doc = _reload(db, Document, uuid.UUID(doc_id))
    doc.status = DocumentStatus.INDEXED  # the owner retried processing and it worked
    db.commit()
    with pytest.raises(queue.InvalidTransition):
        queue.manual_retry(db, _reload(db, ProcessingJob, job_id))
    db.rollback()
    assert _reload(db, Document, uuid.UUID(doc_id)).status == DocumentStatus.INDEXED


# ----------------------------------------------------------------- retry timestamps


def test_manual_retry_updates_queued_time(tenant_id: uuid.UUID, db: Session) -> None:
    def bad(ctx: JobContext) -> None:
        raise PermanentJobError("NOPE", "It failed.")

    registry.register_handler(JobType.EVALUATION_RUN, bad)
    job_id = _enqueue(tenant_id)
    assert _next_outcome() == "failed"
    before = _reload(db, ProcessingJob, job_id).queued_at

    queue.manual_retry(db, _reload(db, ProcessingJob, job_id))
    db.commit()
    job = _reload(db, ProcessingJob, job_id)
    assert job.queued_at > before and job.started_at is None and job.finished_at is None

    registry.register_handler(JobType.EVALUATION_RUN, lambda ctx: None)
    assert _next_outcome() == "succeeded"
    job = _reload(db, ProcessingJob, job_id)
    assert job.started_at is not None and job.started_at >= job.queued_at
