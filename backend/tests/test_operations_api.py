"""Jobs and operations endpoints over HTTP; duplicate delivery; quotas; model concurrency."""

from __future__ import annotations

import threading
import time
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from rackflow.db.models import (
    Chunk,
    JobStatus,
    JobType,
    ProcessingJob,
    Role,
    TenantSettings,
    WorkerHeartbeat,
)
from rackflow.db.session import session_scope
from rackflow.jobs.context import JobContext
from rackflow.providers.chat import _Limiter
from rackflow.providers.vectorstore import get_vector_store
from tests.conftest import Factory
from tests.ingestion.test_pipeline import make_collection, run_worker, upload

pytestmark = [pytest.mark.integration, pytest.mark.qdrant]


def test_jobs_api_visibility_and_actions(client: TestClient, factory: Factory, db: Session) -> None:
    owner = factory.actor(Role.ENGINEER)
    other_eng = factory.actor(Role.ENGINEER)
    operator = factory.actor(Role.OPERATOR)
    auditor = factory.actor(Role.AUDITOR)
    outsider = factory.actor(Role.ORG_ADMIN, tenant="globex")
    restricted = make_collection(client, owner, "Private", "restricted")
    item = upload(client, owner, restricted, [("a.md", b"# A\n\nSome restricted text here.")])[0]
    job_id = item["job_id"]

    assert [j["id"] for j in client.get("/api/v1/jobs", headers=owner.headers).json()["items"]] \
        == [job_id]
    assert client.get("/api/v1/jobs", headers=other_eng.headers).json()["items"] == []
    assert client.get(f"/api/v1/jobs/{job_id}", headers=other_eng.headers).status_code == 404
    assert client.get(f"/api/v1/jobs/{job_id}", headers=outsider.headers).status_code == 404
    assert client.get(f"/api/v1/jobs/{job_id}", headers=auditor.headers).status_code == 200
    assert client.post(f"/api/v1/jobs/{job_id}/cancel",
                       headers=auditor.headers).status_code == 403
    assert client.post(f"/api/v1/jobs/{job_id}/cancel",
                       headers=owner.headers).status_code == 403  # engineers lack job:manage

    r = client.post(f"/api/v1/jobs/{job_id}/cancel", headers=operator.headers)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    doc = client.get(f"/api/v1/documents/{item['document_id']}", headers=owner.headers).json()
    assert doc["status"] == "failed"  # cancelled ingestion leaves a retryable failed document
    assert client.post(f"/api/v1/jobs/{job_id}/cancel",
                       headers=operator.headers).status_code == 409

    r = client.post(f"/api/v1/jobs/{job_id}/retry", headers=operator.headers)
    assert r.status_code == 200 and r.json()["status"] == "queued"
    run_worker()
    detail = client.get(f"/api/v1/jobs/{job_id}", headers=operator.headers).json()
    assert detail["status"] == "succeeded"
    assert {s["stage"] for s in detail["stages"]} >= {"extract", "chunk", "index"}
    page = client.get("/api/v1/jobs?status=succeeded&job_type=ingest_document",
                      headers=operator.headers).json()
    assert [j["id"] for j in page["items"]] == [job_id]


def test_operations_summary_matches_database(client: TestClient, factory: Factory,
                                             db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    op = factory.actor(Role.OPERATOR)
    outsider = factory.actor(Role.ORG_ADMIN, tenant="globex")
    cid = make_collection(client, eng)
    upload(client, eng, cid, [("a.md", b"# Alpha\n\nAlpha runbook: restart the alpha service."),
                              ("b.md", b"# Beta\n\nBeta runbook: rotate the beta certificates.")])
    summary = client.get("/api/v1/operations/summary", headers=op.headers).json()
    queued_db = db.scalar(select(func.count()).select_from(ProcessingJob).where(
        ProcessingJob.tenant_id == op.tenant_id, ProcessingJob.status == JobStatus.QUEUED))
    assert summary["jobs"]["queued"] == queued_db == 2
    assert summary["queue_depth"] == 2 and summary["oldest_queued_age_seconds"] is not None
    run_worker()
    summary = client.get("/api/v1/operations/summary", headers=op.headers).json()
    chunks_db = db.scalar(select(func.count()).select_from(Chunk).where(
        Chunk.tenant_id == op.tenant_id))
    assert summary["jobs"]["succeeded"] == 2 and summary["queue_depth"] == 0
    assert summary["documents"]["indexed"] == 2 and summary["indexed_chunks"] == chunks_db
    other = client.get("/api/v1/operations/summary", headers=outsider.headers).json()
    assert other["jobs"]["succeeded"] == 0 and other["indexed_chunks"] == 0

    metrics = client.get("/api/v1/operations/metrics?window=1h", headers=op.headers).json()
    assert sum(b["succeeded"] for b in metrics["buckets"]) == 2
    assert metrics["error_rate"] == 0.0 and "chunk" in metrics["stage_durations_ms"]
    assert client.get("/api/v1/operations/summary", headers=eng.headers).status_code == 403


def test_workers_endpoint_hides_foreign_jobs(client: TestClient, factory: Factory) -> None:
    op = factory.actor(Role.OPERATOR)
    foreign_job = uuid.uuid4()
    now = datetime.now(UTC)
    with session_scope() as s:
        s.add(WorkerHeartbeat(worker_id="w-test", hostname="h", pid=1, status="busy",
                              current_job_id=foreign_job, jobs_succeeded=3, jobs_failed=1,
                              started_at=now, last_heartbeat_at=now, version="t",
                              capabilities={}))
    workers = client.get("/api/v1/operations/workers", headers=op.headers).json()["items"]
    w = next(x for x in workers if x["worker_id"] == "w-test")
    assert w["health"] == "healthy" and w["current_job_id"] is None


def test_duplicate_delivery_creates_no_duplicates(client: TestClient, factory: Factory,
                                                  db: Session) -> None:
    from rackflow.ingestion.orchestrator import process_document

    eng = factory.actor(Role.ENGINEER)
    cid = make_collection(client, eng)
    item = upload(client, eng, cid, [("dup.md", b"# Dup\n\n" + b"Repeated content. " * 200)])[0]
    job = db.get(ProcessingJob, uuid.UUID(item["job_id"]))
    assert job is not None
    for attempt in (1, 2):  # the same job delivered twice (e.g. after a lost acknowledgement)
        ctx = JobContext(db=db, job_id=job.id, tenant_id=job.tenant_id,
                         document_id=job.document_id, attempt_number=attempt, worker_id="t",
                         correlation_id="c", payload=dict(job.payload))
        process_document(ctx)
    chunk_count = db.scalar(select(func.count()).select_from(Chunk).where(
        Chunk.document_id == job.document_id))
    assert chunk_count and chunk_count > 1
    assert get_vector_store().count_document(eng.tenant_id, job.document_id) == chunk_count


def test_storage_quota_enforced(client: TestClient, factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    with session_scope() as s:
        s.merge(TenantSettings(tenant_id=eng.tenant_id, max_storage_bytes=1_048_576))
    cid = make_collection(client, eng)
    items = upload(client, eng, cid, [("small.md", b"# ok\n\nfits within the quota"),
                                      ("big.txt", b"x " * 600_000)])
    assert items[0]["status"] == "queued"
    assert items[1]["status"] == "rejected" and items[1]["error"]["code"] == "QUOTA_EXCEEDED"


def test_model_concurrency_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    from rackflow.providers import chat

    monkeypatch.setattr(chat, "_CONCURRENCY_WAIT_SECONDS", 0.2)
    limiter = _Limiter(1)
    entered = threading.Event()
    release = threading.Event()

    def hold() -> None:
        with limiter:
            entered.set()
            release.wait(5)

    t = threading.Thread(target=hold)
    t.start()
    entered.wait(5)
    started = time.monotonic()
    with pytest.raises(chat.ModelError) as err, limiter:
        pass
    assert err.value.code == "MODEL_OVERLOADED" and time.monotonic() - started < 2
    release.set()
    t.join()
    with limiter:  # capacity is released afterwards
        pass


def test_job_type_filter_validation(client: TestClient, factory: Factory) -> None:
    op = factory.actor(Role.OPERATOR)
    assert client.get("/api/v1/jobs?status=bogus", headers=op.headers).status_code == 422
    assert client.get("/api/v1/jobs?cursor=not-a-cursor", headers=op.headers).status_code == 422
    assert JobType.EVALUATION_RUN.value == "evaluation_run"
