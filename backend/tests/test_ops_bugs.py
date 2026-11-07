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
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError
from sqlalchemy.orm import Session

from rackflow.cli import ensure_tenant
from rackflow.cli import main as admin_cli
from rackflow.core.errors import AppError
from rackflow.db.models import (
    Document,
    DocumentStatus,
    JobStatus,
    JobType,
    ProcessingJob,
    Role,
    TenantSettings,
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
from rackflow.providers.chat import _model_error
from rackflow.rag import indexing
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
                    answer: Callable[..., Any], monkeypatch: pytest.MonkeyPatch,
                    visibility: str = "tenant") -> dict[str, Any]:
    monkeypatch.setattr(eval_runner, "answer_question", answer)
    collection = make_collection(client, actor, f"Eval {uuid.uuid4().hex[:6]}", visibility)
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


# ------------------------------------------------- evaluation: who may read a run's answers


def _answer_citing_a_file(*_: Any, **__: Any) -> SimpleNamespace:
    source = SimpleNamespace(filename="secret-plan.md")
    return SimpleNamespace(sources=[source], citations=[SimpleNamespace(chunk=source)],
                           answer="The secret plan says this.", evidence_status="supported",
                           latency_ms=5)


def test_run_answers_stay_inside_the_collections_they_came_from(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    engineer = factory.actor(Role.ENGINEER)
    auditor = factory.actor(Role.AUDITOR)
    run = _run_evaluation(client, admin, _answer_citing_a_file, monkeypatch, "restricted")
    assert all(r["answer"] and r["cited_docs"] == ["secret-plan.md"] for r in run["results"])
    url = f"/api/v1/evaluation/runs/{run['id']}"

    # The engineer may read document content, just not in this collection.
    seen = client.get(url, headers=engineer.headers).json()
    assert seen["metrics"] == run["metrics"] and len(seen["results"]) == len(run["results"])
    assert "secret" not in str(seen["results"]).lower()
    for result in seen["results"]:
        assert not {"question", "answer", "retrieved_docs", "cited_docs"} & set(result)
        assert result["id"] and "retrieval_hit" in result

    # Auditors see filenames across the tenant, as metadata, and never question or answer.
    audited = client.get(url, headers=auditor.headers).json()
    assert all(r["cited_docs"] == ["secret-plan.md"] for r in audited["results"])
    assert all("answer" not in r and "question" not in r for r in audited["results"])


def test_run_answers_show_to_a_reader_with_access_to_every_collection(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    engineer = factory.actor(Role.ENGINEER)
    run = _run_evaluation(client, admin, _answer_citing_a_file, monkeypatch)
    seen = client.get(f"/api/v1/evaluation/runs/{run['id']}", headers=engineer.headers).json()
    assert seen["results"] == run["results"]


def test_run_answers_hide_when_one_of_several_collections_is_off_limits(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    engineer = factory.actor(Role.ENGINEER)
    monkeypatch.setattr(eval_runner, "answer_question", _answer_citing_a_file)
    open_one = make_collection(client, admin, "Open one")
    closed_one = make_collection(client, admin, "Closed one", "restricted")
    created = client.post("/api/v1/evaluation/runs", headers=admin.headers, json={
        "dataset_version": "v1", "collection_ids": [open_one, closed_one]})
    assert created.status_code == 202, created.text
    run_worker()
    seen = client.get(f"/api/v1/evaluation/runs/{created.json()['id']}",
                      headers=engineer.headers).json()
    assert seen["results"] and all("answer" not in r for r in seen["results"])


# ---------------------------------------------- evaluation: waiting for a rate-limited model


class _BusyFor(AppError):
    """A busy error that says how long to wait, as a provider's Retry-After does."""

    def __init__(self, seconds: float) -> None:
        super().__init__("Busy.", code="MODEL_OVERLOADED", status_code=503)
        self.retry_after = seconds


@pytest.fixture()
def waits(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Every wait the runner asks for. Nothing in these tests really sleeps."""
    recorded: list[float] = []
    monkeypatch.setattr(eval_runner, "_sleep", recorded.append)
    return recorded


def test_small_rate_limited_model_scores_the_whole_dataset(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch,
        waits: list[float]) -> None:
    """A model that takes one question a minute, with time passing only through the run's waits."""
    answered_at: list[float] = []

    def limited(*_: Any, **__: Any) -> Any:
        now = sum(waits)
        if answered_at and now - answered_at[-1] < 60:
            raise _model_error("MODEL_OVERLOADED")
        answered_at.append(now)
        return _good_answer()

    run = _run_evaluation(client, factory.actor(Role.ORG_ADMIN), limited, monkeypatch)
    assert run["status"] == "completed"
    assert run["metrics"]["errors"] == 0 and run["metrics"]["questions"] == 13
    assert sum(waits) >= 60 * 12  # one window between each pair of questions


def test_dead_model_fails_fast_after_one_full_wait(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch,
        waits: list[float]) -> None:
    calls = {"n": 0}

    def dead(*_: Any, **__: Any) -> Any:
        calls["n"] += 1
        raise _model_error("MODEL_OVERLOADED")

    run = _run_evaluation(client, factory.actor(Role.ORG_ADMIN), dead, monkeypatch)
    assert run["status"] == "completed_with_errors"
    assert run["metrics"]["errors"] == run["metrics"]["questions"] == 13
    assert all(r["error"] == "MODEL_OVERLOADED" for r in run["results"])
    assert sum(waits) == sum(eval_runner.BUSY_BACKOFF_SECONDS)  # bounded, and spent only once
    assert calls["n"] == len(eval_runner.BUSY_BACKOFF_SECONDS) + 13


def test_patience_returns_once_the_model_answers_again(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch,
        waits: list[float]) -> None:
    budget = sum(eval_runner.BUSY_BACKOFF_SECONDS)
    calls = {"n": 0}

    def flaky(*_: Any, **__: Any) -> Any:
        calls["n"] += 1
        # Q1 uses every wait, Q2 gets one try and fails, Q3 answers, Q4 may wait again.
        attempts_before_q3 = len(eval_runner.BUSY_BACKOFF_SECONDS) + 2
        if calls["n"] <= attempts_before_q3 or calls["n"] == attempts_before_q3 + 2:
            raise _model_error("MODEL_OVERLOADED")
        return _good_answer()

    run = _run_evaluation(client, factory.actor(Role.ORG_ADMIN), flaky, monkeypatch)
    assert run["metrics"]["errors"] == 2
    assert sum(waits) == budget + eval_runner.BUSY_BACKOFF_SECONDS[0]


@pytest.mark.parametrize(("retry_after", "waited", "errors"), [(60, 61, 0), (3600, 0, 1)],
                         ids=["a-minute-is-waited-out", "an-hour-is-not"])
def test_run_honours_the_wait_the_model_asks_for(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch,
        waits: list[float], retry_after: int, waited: int, errors: int) -> None:
    calls = {"n": 0}

    def once(*_: Any, **__: Any) -> Any:
        calls["n"] += 1
        if calls["n"] == 1:
            raise _BusyFor(retry_after)
        return _good_answer()

    run = _run_evaluation(client, factory.actor(Role.ORG_ADMIN), once, monkeypatch)
    assert sum(waits) == waited and run["metrics"]["errors"] == errors


def test_other_errors_are_not_waited_for(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch,
        waits: list[float]) -> None:
    def refused(*_: Any, **__: Any) -> Any:
        raise _model_error("MODEL_MISCONFIGURED")

    run = _run_evaluation(client, factory.actor(Role.ORG_ADMIN), refused, monkeypatch)
    assert waits == [] and run["metrics"]["errors"] == 13


def test_cancel_is_noticed_during_a_wait(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    def cancel_instead_of_sleeping(_: float) -> None:
        with session_scope() as s:
            s.execute(update(ProcessingJob)
                      .where(ProcessingJob.job_type == JobType.EVALUATION_RUN)
                      .values(cancel_requested=True))

    def busy(*_: Any, **__: Any) -> Any:
        raise _model_error("MODEL_OVERLOADED")

    monkeypatch.setattr(eval_runner, "_sleep", cancel_instead_of_sleeping)
    run = _run_evaluation(client, factory.actor(Role.ORG_ADMIN), busy, monkeypatch)
    assert run["status"] == "cancelled"


def test_long_wait_keeps_the_lease(waits: list[float]) -> None:
    beats = {"n": 0}

    def beat() -> None:
        beats["n"] += 1

    ctx = SimpleNamespace(check_cancelled=lambda: None, heartbeat=beat,
                          db=SimpleNamespace(rollback=lambda: None))
    eval_runner._wait(cast(JobContext, ctx), 65.0)
    assert sum(waits) == 65.0 and max(waits) <= eval_runner.WAIT_TICK_SECONDS
    assert beats["n"] == len(waits)  # the runner renews the lease from these, at 1/4 of its length


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


# ------------------------------------------ retrying or re-indexing what should stay as it is


def _ingest_job_of(db: Session, doc_id: str) -> uuid.UUID:
    job_id = db.scalar(select(ProcessingJob.id).where(
        ProcessingJob.document_id == uuid.UUID(doc_id),
        ProcessingJob.job_type == JobType.INGEST_DOCUMENT))
    assert job_id is not None
    return job_id


def _refused_retry(client: TestClient, actor: Actor, job_id: uuid.UUID) -> str:
    resp = client.post(f"/api/v1/jobs/{job_id}/retry", headers=actor.headers)
    assert resp.status_code == 409, resp.text
    assert resp.json()["error"]["code"] == "INVALID_JOB_STATE"
    return str(resp.json()["error"]["message"])


def test_stale_ingest_job_cannot_reprocess_a_healthy_document(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    op = factory.actor(Role.OPERATOR)

    def bad(ctx: JobContext) -> None:
        raise PermanentJobError("NO_EXTRACTABLE_TEXT", "No usable text.")

    registry.register_handler(JobType.INGEST_DOCUMENT, bad)
    cid = make_collection(client, eng, f"Stale {uuid.uuid4().hex[:6]}")
    doc_id = upload(client, eng, cid, [("a.md", b"# A\n\nSome text.")])[0]["document_id"]
    assert _next_outcome() == "failed"
    stale = _ingest_job_of(db, doc_id)

    # The owner's retry made a second job, and it worked.
    assert client.post(f"/api/v1/documents/{doc_id}/retry",
                       headers=eng.headers).status_code == 202
    registry.register_handler(JobType.INGEST_DOCUMENT, lambda ctx: None)
    assert _next_outcome() == "succeeded"
    doc = _reload(db, Document, uuid.UUID(doc_id))
    doc.status = DocumentStatus.INDEXED
    db.commit()

    assert "out of date" in _refused_retry(client, op, stale)
    assert _reload(db, ProcessingJob, stale).status == JobStatus.FAILED
    assert _reload(db, Document, uuid.UUID(doc_id)).status == DocumentStatus.INDEXED


def test_failed_ingest_job_of_a_failed_document_can_still_be_retried(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    op = factory.actor(Role.OPERATOR)

    def bad(ctx: JobContext) -> None:
        raise PermanentJobError("NO_EXTRACTABLE_TEXT", "No usable text.")

    registry.register_handler(JobType.INGEST_DOCUMENT, bad)
    cid = make_collection(client, eng, f"Again {uuid.uuid4().hex[:6]}")
    doc_id = upload(client, eng, cid, [("a.md", b"# A\n\nSome text.")])[0]["document_id"]
    assert _next_outcome() == "failed"
    resp = client.post(f"/api/v1/jobs/{_ingest_job_of(db, doc_id)}/retry", headers=op.headers)
    assert resp.status_code == 200, resp.text
    assert _reload(db, Document, uuid.UUID(doc_id)).status == DocumentStatus.QUEUED


def test_job_retry_refuses_a_row_that_keeps_deleted_at(
        client: TestClient, factory: Factory, db: Session) -> None:
    """Retrieval hides it for good, so it would read as indexed and never be answerable."""
    eng = factory.actor(Role.ENGINEER)
    op = factory.actor(Role.OPERATOR)
    _fail_deletes()
    content = b"# Copy\n\nThe same bytes uploaded twice."
    doc_id, _, cid = _request_delete(client, eng, content)
    upload(client, eng, cid, [("del.md", content)])  # the copy takes the dedup slot
    assert _next_outcome() == "failed"
    doc = _reload(db, Document, uuid.UUID(doc_id))
    assert doc.status == DocumentStatus.FAILED and doc.deleted_at is not None

    ingest = _ingest_job_of(db, doc_id)
    assert _reload(db, ProcessingJob, ingest).status == JobStatus.CANCELLED
    assert "deleted again" in _refused_retry(client, op, ingest)
    assert _reload(db, Document, uuid.UUID(doc_id)).status == DocumentStatus.FAILED


def test_job_retry_refuses_the_ingest_job_a_delete_cancelled(
        client: TestClient, factory: Factory, db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    op = factory.actor(Role.OPERATOR)
    _fail_deletes()
    doc_id, _, _ = _request_delete(client, eng)
    assert _next_outcome() == "failed"
    assert _reload(db, Document, uuid.UUID(doc_id)).deleted_at is None
    assert "deleted again" in _refused_retry(client, op, _ingest_job_of(db, doc_id))


def test_reindex_include_failed_skips_documents_someone_asked_to_delete(
        client: TestClient, factory: Factory, db: Session,
        capsys: pytest.CaptureFixture[str]) -> None:
    eng = factory.actor(Role.ENGINEER)
    _fail_deletes()
    deleted_id, _, cid = _request_delete(client, eng)
    assert _next_outcome() == "failed"
    assert _reload(db, Document, uuid.UUID(deleted_id)).deleted_at is None
    # A document whose ingestion really did fail, which the flag exists for.
    failed_id = upload(client, eng, cid, [("f.md", b"# F\n\nIngestion failed.")])[0]["document_id"]
    db.execute(update(Document).where(Document.id == uuid.UUID(failed_id))
               .values(status=DocumentStatus.FAILED))
    db.commit()
    capsys.readouterr()

    assert admin_cli(["reindex", "--tenant", "acme", "--include-failed", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert f"skipped     {deleted_id}" in out and "would queue 1 document(s)" in out

    assert admin_cli(["reindex", "--tenant", "acme", "--include-failed"]) == 0
    out = capsys.readouterr().out
    assert f"skipped     {deleted_id}" in out and "queued 1 document(s)" in out
    assert "Skipped 1 whose delete did not finish" in out
    keys = db.scalars(select(ProcessingJob.idempotency_key)
                      .where(ProcessingJob.idempotency_key.like("reindex:%"))).all()
    assert keys == [f"reindex:{failed_id}:2"]
    db.expire_all()
    assert _reload(db, Document, uuid.UUID(deleted_id)).status == DocumentStatus.FAILED


def test_reindex_includes_a_document_retried_after_its_delete_gave_up(
        client: TestClient, factory: Factory, db: Session,
        capsys: pytest.CaptureFixture[str]) -> None:
    """The owner chose to keep it, and that attempt failed: it is an ordinary failure now."""
    eng = factory.actor(Role.ENGINEER)
    _fail_deletes()
    doc_id, _, _ = _request_delete(client, eng)
    assert _next_outcome() == "failed"
    assert client.post(f"/api/v1/documents/{doc_id}/retry", headers=eng.headers).status_code == 202
    db.execute(update(Document).where(Document.id == uuid.UUID(doc_id))
               .values(status=DocumentStatus.FAILED))
    db.commit()
    assert admin_cli(["reindex", "--tenant", "acme", "--include-failed"]) == 0
    assert "queued 1 document(s)" in capsys.readouterr().out


# ------------------------------------------------- a delete that overtakes a running ingest


_READABLE = b"# Runbook\n\n" + b"Rotate the TLS certificates every ninety days. " * 8


def _ingest_with_interruption(monkeypatch: pytest.MonkeyPatch, status: DocumentStatus,
                              doc_id: uuid.UUID) -> list[uuid.UUID]:
    """Runs the real pipeline, with the cancel arriving while the vectors are being written."""
    discarded: list[uuid.UUID] = []

    def writes_vectors(ctx: JobContext, version_id: uuid.UUID) -> None:
        with session_scope() as s:
            s.execute(update(ProcessingJob).where(ProcessingJob.id == ctx.job_id)
                      .values(cancel_requested=True))
            s.execute(update(Document).where(Document.id == doc_id).values(status=status))

    def discard(_: uuid.UUID, document_id: uuid.UUID, **__: Any) -> None:
        discarded.append(document_id)

    monkeypatch.setattr(indexing, "index_document_version", writes_vectors)
    monkeypatch.setattr(indexing, "delete_document_vectors", discard)
    assert _next_outcome() == "cancelled"
    return discarded


@pytest.mark.parametrize("status", [DocumentStatus.DELETING, DocumentStatus.DELETED])
def test_vectors_written_after_a_delete_are_discarded(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch,
        status: DocumentStatus) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = make_collection(client, eng, f"Race {uuid.uuid4().hex[:6]}")
    doc_id = uuid.UUID(upload(client, eng, cid, [("a.md", _READABLE)])[0]["document_id"])
    assert _ingest_with_interruption(monkeypatch, status, doc_id) == [doc_id]


def test_cancelled_ingest_of_a_live_document_keeps_its_vectors(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = make_collection(client, eng, f"Race {uuid.uuid4().hex[:6]}")
    doc_id = uuid.UUID(upload(client, eng, cid, [("a.md", _READABLE)])[0]["document_id"])
    assert _ingest_with_interruption(monkeypatch, DocumentStatus.PROCESSING, doc_id) == []


# ----------------------------------------------------------------------- upload quota


def test_duplicate_upload_is_reported_even_when_the_workspace_is_full(
        client: TestClient, factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = make_collection(client, eng, f"Full {uuid.uuid4().hex[:6]}")
    content = b"# Stored\n\nAlready in the workspace."
    first = upload(client, eng, cid, [("stored.md", content)])[0]
    assert first["status"] == "queued"
    with session_scope() as s:
        s.merge(TenantSettings(tenant_id=eng.tenant_id, max_storage_bytes=len(content)))

    same, new = upload(client, eng, cid, [("stored.md", content), ("new.md", b"# New\n\nBytes.")])
    assert same["status"] == "duplicate" and same["document_id"] == first["document_id"]
    assert new["status"] == "rejected" and new["error"]["code"] == "QUOTA_EXCEEDED"


# ------------------------------------------------------------------- infrastructure PATCH


def _inventory(client: TestClient, actor: Actor) -> dict[str, str]:
    def post(path: str, body: dict[str, Any]) -> str:
        resp = client.post(f"/api/v1/infrastructure/{path}", headers=actor.headers, json=body)
        assert resp.status_code == 201, resp.text
        return str(resp.json()["id"])

    rack = post("racks", {"name": "r1", "location_label": "Row A"})
    node = post("nodes", {"name": "n1", "rack_id": rack, "cpu_cores": 8})
    workload = post("workloads", {"name": "w1", "workload_type": "api", "node_id": node,
                                  "state_source": "simulated",
                                  "resource_request": {"cpu_cores": 0.5}})
    return {"racks": rack, "nodes": node, "workloads": workload}


@pytest.mark.parametrize(("kind", "field"), [
    ("racks", "name"), ("racks", "environment"), ("racks", "description"), ("racks", "status"),
    ("nodes", "name"), ("nodes", "status"),
    ("workloads", "desired_state"), ("workloads", "observed_state"),
    ("workloads", "resource_request"),
])
def test_patch_refuses_null_for_required_fields(
        client: TestClient, factory: Factory, kind: str, field: str) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    ids = _inventory(client, admin)
    resp = client.patch(f"/api/v1/infrastructure/{kind}/{ids[kind]}", headers=admin.headers,
                        json={field: None})
    assert resp.status_code == 422, resp.text


@pytest.mark.parametrize(("kind", "field"), [
    ("racks", "location_label"), ("nodes", "rack_id"), ("nodes", "rack_unit_position"),
    ("nodes", "cpu_cores"), ("nodes", "memory_bytes"), ("nodes", "accelerator_info"),
    ("nodes", "storage_bytes"), ("workloads", "node_id"),
])
def test_patch_still_clears_optional_fields(
        client: TestClient, factory: Factory, kind: str, field: str) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    ids = _inventory(client, admin)
    resp = client.patch(f"/api/v1/infrastructure/{kind}/{ids[kind]}", headers=admin.headers,
                        json={field: None})
    assert resp.status_code == 200, resp.text


def test_allocated_cpu_keeps_fractions(client: TestClient, factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    ids = _inventory(client, admin)

    def allocated() -> float:
        rack = client.get(f"/api/v1/infrastructure/racks/{ids['racks']}",
                          headers=admin.headers).json()
        return float(rack["nodes"][0]["allocated"]["cpu_cores"])

    assert allocated() == 0.5
    for name, cores in (("w2", 3), ("w3", 0.1), ("w4", 0.2)):
        assert client.post("/api/v1/infrastructure/workloads", headers=admin.headers, json={
            "name": name, "workload_type": "api", "node_id": ids["nodes"],
            "resource_request": {"cpu_cores": cores}}).status_code == 201
    assert allocated() == 3.8  # rounded: floating point would make this 3.8000000000000003


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
