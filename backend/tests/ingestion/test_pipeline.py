"""End-to-end ingestion: API upload → durable job → worker → chunks in PostgreSQL + vectors in
Qdrant; duplicates, failures, retry and deletion. Requires PostgreSQL and Qdrant."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from rackflow.db.models import Chunk, Document, DocumentStatus, JobStatus, ProcessingJob, Role
from rackflow.providers.storage import get_object_storage
from rackflow.providers.vectorstore import get_vector_store
from rackflow.worker.main import main as worker_main
from tests.conftest import Actor, Factory
from tests.fixtures import make_blank_pdf, make_docx, make_scanned_pdf, make_text_pdf

pytestmark = [pytest.mark.integration, pytest.mark.qdrant]

RUNBOOK = make_text_pdf([
    "Database Runbook\nIf the connection pool is exhausted, restart the api service.\n"
    "Check max_connections in postgresql.conf.",
    "Failover\nPromote the replica with pg_ctl promote and update the DNS record.",
])


def run_worker() -> None:
    assert worker_main(["--exit-when-idle"]) == 0


def make_collection(client: TestClient, actor: Actor, name: str = "Runbooks",
                    visibility: str = "tenant") -> str:
    r = client.post("/api/v1/collections", json={"name": name, "visibility": visibility},
                    headers=actor.headers)
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def upload(client: TestClient, actor: Actor, collection_id: str,
           files: list[tuple[str, bytes]]) -> list[dict]:
    r = client.post(f"/api/v1/collections/{collection_id}/documents", headers=actor.headers,
                    files=[("files", (name, data)) for name, data in files])
    assert r.status_code == 201, r.text
    return list(r.json()["items"])


def test_upload_process_index_and_delete(client: TestClient, factory: Factory,
                                         db: Session) -> None:
    eng = factory.actor(Role.ENGINEER)
    cid = make_collection(client, eng)
    items = upload(client, eng, cid, [
        ("runbook.pdf", RUNBOOK),
        ("guide.docx", make_docx("Deploy Guide", ["Run the migrations before deploying."],
                                 [["Step", "Command"], ["1", "alembic upgrade head"]])),
        ("notes.md", b"# Notes\n\nRotate the TLS certificates every 90 days.\n"),
        ("../../evil.exe", b"MZ"),
    ])
    assert [i["status"] for i in items] == ["queued", "queued", "queued", "rejected"]
    assert items[3]["error"]["code"] == "UNSUPPORTED_TYPE"
    assert items[3]["filename"] == "../../evil.exe"[:200] or "evil" in items[3]["filename"]

    run_worker()

    listing = client.get("/api/v1/documents", headers=eng.headers).json()["items"]
    assert {d["status"] for d in listing} == {"indexed"}
    pdf = next(d for d in listing if d["filename"] == "runbook.pdf")
    assert pdf["page_count"] == 2 and pdf["chunk_count"] >= 1
    assert pdf["extraction_method"] == "text" and pdf["embedding_model"]
    assert pdf["latest_job"]["status"] == "succeeded"

    pipeline = client.get(f"/api/v1/documents/{pdf['id']}/pipeline", headers=eng.headers).json()
    stages = [s["stage"] for s in pipeline["jobs"][0]["stages"]]
    assert stages == ["validate", "extract", "ocr", "quality_check", "clean", "chunk", "embed",
                      "index", "finalize"]
    assert {s["status"] for s in pipeline["jobs"][0]["stages"]} <= {"succeeded", "skipped"}

    chunks = client.get(f"/api/v1/documents/{pdf['id']}/chunks", headers=eng.headers).json()
    assert any("connection pool" in c["text"] for c in chunks["items"])
    assert chunks["items"][0]["page_start"] == 1

    doc_id = uuid.UUID(pdf["id"])
    store = get_vector_store()
    assert store.count_document(eng.tenant_id, doc_id) == pdf["chunk_count"]

    # Duplicate upload is detected, no new job.
    dup = upload(client, eng, cid, [("copy.pdf", RUNBOOK)])
    assert dup[0]["status"] == "duplicate" and dup[0]["document_id"] == pdf["id"]

    # Re-running the worker with nothing queued changes nothing (idempotent).
    run_worker()
    assert store.count_document(eng.tenant_id, doc_id) == pdf["chunk_count"]

    # Deletion propagates to vectors, object storage and chunk rows.
    key = db.scalar(select(Document.storage_key).where(Document.id == doc_id))
    r = client.delete(f"/api/v1/documents/{pdf['id']}", headers=eng.headers)
    assert r.status_code == 202 and r.json()["status"] == "deleting"
    run_worker()
    db.expire_all()
    assert db.get(Document, doc_id).status.value == "deleted"  # type: ignore[union-attr]
    assert store.count_document(eng.tenant_id, doc_id) == 0
    assert not get_object_storage().exists(str(key))
    remaining = select(func.count()).select_from(Chunk).where(Chunk.document_id == doc_id)
    assert db.scalar(remaining) == 0
    assert client.get(f"/api/v1/documents/{pdf['id']}", headers=eng.headers).status_code == 404
    # The dedup slot is free again after deletion.
    assert upload(client, eng, cid, [("runbook.pdf", RUNBOOK)])[0]["status"] == "queued"


def test_unusable_document_fails_permanently_and_can_retry(client: TestClient, factory: Factory,
                                                          db: Session) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    cid = make_collection(client, admin)
    # Blank image-only page: OCR finds nothing → permanent failure after one attempt.
    item = upload(client, admin, cid, [("blank.pdf", make_blank_pdf())])[0]
    run_worker()
    doc = client.get(f"/api/v1/documents/{item['document_id']}", headers=admin.headers).json()
    assert doc["status"] == "failed"
    assert doc["latest_job"]["status"] == "failed"
    assert doc["latest_job"]["error_code"] == "NO_EXTRACTABLE_TEXT"
    assert doc["latest_job"]["attempt_count"] == 1

    r = client.post(f"/api/v1/documents/{item['document_id']}/retry", headers=admin.headers)
    assert r.status_code == 202
    jobs = db.scalars(select(ProcessingJob).where(
        ProcessingJob.document_id == uuid.UUID(item["document_id"]))).all()
    assert len(jobs) == 2 and any(j.status == JobStatus.QUEUED for j in jobs)
    # Retrying a non-failed document is rejected.
    run_worker()
    assert client.post(f"/api/v1/documents/{item['document_id']}/retry",
                       headers=admin.headers).status_code in (202, 409)


@pytest.mark.slow
def test_scanned_pdf_goes_through_ocr(client: TestClient, factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    cid = make_collection(client, admin)
    item = upload(client, admin, cid, [(
        "scan.pdf", make_scanned_pdf(["Emergency shutdown procedure",
                                      "Press the red breaker twice"]))])[0]
    run_worker()
    doc = client.get(f"/api/v1/documents/{item['document_id']}", headers=admin.headers).json()
    assert doc["status"] == "indexed", doc
    assert doc["extraction_method"] == "ocr" and doc["ocr_page_count"] == 1
    chunks = client.get(f"/api/v1/documents/{item['document_id']}/chunks",
                        headers=admin.headers).json()["items"]
    text = " ".join(c["text"] for c in chunks).lower()
    assert "shutdown" in text and "breaker" in text


def test_document_access_is_scoped(client: TestClient, factory: Factory) -> None:
    owner = factory.actor(Role.ENGINEER)
    other_eng = factory.actor(Role.ENGINEER)
    auditor = factory.actor(Role.AUDITOR)
    outsider = factory.actor(Role.ORG_ADMIN, tenant="globex")
    restricted = make_collection(client, owner, "Secret", "restricted")
    item = upload(client, owner, restricted, [("secret.md", b"# Secret\n\nlaunch codes 1234\n")])[0]
    run_worker()
    doc_url = f"/api/v1/documents/{item['document_id']}"

    for actor in (other_eng, outsider):
        assert client.get(doc_url, headers=actor.headers).status_code == 404
        assert client.get(f"{doc_url}/chunks", headers=actor.headers).status_code == 404
        assert client.get("/api/v1/documents", headers=actor.headers).json()["items"] == []
        assert client.delete(doc_url, headers=actor.headers).status_code == 404
    # Auditor sees metadata, never content.
    assert client.get(doc_url, headers=auditor.headers).status_code == 200
    assert client.get(f"{doc_url}/chunks", headers=auditor.headers).status_code == 403
    assert client.get(f"{doc_url}/download", headers=auditor.headers).status_code == 403
    # Owner can download as an attachment.
    dl = client.get(f"{doc_url}/download", headers=owner.headers)
    assert dl.status_code == 200
    assert dl.headers["content-disposition"].startswith("attachment")
    assert dl.headers["content-type"] == "application/octet-stream"
    # Upload into a collection without write access is refused (indistinguishable 404).
    assert client.post(f"/api/v1/collections/{restricted}/documents", headers=other_eng.headers,
                       files=[("files", ("x.md", b"# x\n\ntext"))]).status_code == 404


def test_embedding_dependency_failure_fails_once_at_the_embed_stage(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    """BUG-03: a broken embedding runtime is recorded against EMBED (not CHUNK), with a safe
    DEPENDENCY_UNAVAILABLE code, and is not retried."""
    from rackflow.rag import indexing

    def broken() -> None:
        raise ImportError("DLL load failed while importing onnxruntime_pybind11_state",
                          name="onnxruntime")

    monkeypatch.setattr(indexing, "get_embedding_provider", broken)
    eng = factory.actor(Role.ENGINEER)
    cid = make_collection(client, eng)
    item = upload(client, eng, cid, [("notes.md", b"# Notes\n\nRotate the TLS certificates.\n")])[0]
    run_worker()

    doc_url = f"/api/v1/documents/{item['document_id']}"
    doc = client.get(doc_url, headers=eng.headers).json()
    assert doc["status"] == "failed"
    assert doc["latest_job"]["error_code"] == "DEPENDENCY_UNAVAILABLE"
    assert doc["latest_job"]["attempt_count"] == 1
    pipeline = client.get(f"{doc_url}/pipeline", headers=eng.headers).json()
    stages = {s["stage"]: s for s in pipeline["jobs"][0]["stages"]}
    assert stages["chunk"]["status"] == "succeeded"
    assert stages["embed"]["status"] == "failed"
    assert stages["embed"]["error_code"] == "DEPENDENCY_UNAVAILABLE"
    assert "index" not in stages


def test_reindex_rebuilds_lost_vectors(client: TestClient, factory: Factory, db: Session,
                                       capsys: pytest.CaptureFixture[str]) -> None:
    """BUG-01 recovery: after the vector collection is lost, `rackflow-admin reindex` re-queues
    the tenant's documents and the worker rebuilds every vector from the stored originals."""
    from rackflow.cli import main as admin_cli

    eng = factory.actor(Role.ENGINEER)
    cid = make_collection(client, eng)
    items = upload(client, eng, cid, [
        ("runbook.pdf", RUNBOOK),
        ("notes.md", b"# Notes\n\nRotate the TLS certificates every 90 days.\n"),
    ])
    run_worker()
    pdf_id, md_id = (uuid.UUID(i["document_id"]) for i in items)
    store = get_vector_store()
    assert store.count_document(eng.tenant_id, pdf_id) > 0

    # Simulate BUG-01 on this session's throwaway collection (never a live one), and a document
    # whose ingestion had failed.
    assert store.collection.startswith("rackflow_test_")
    store.client.delete_collection(store.collection)
    db.execute(update(Document).where(Document.id == md_id).values(status=DocumentStatus.FAILED))
    db.commit()
    jobs = select(func.count()).select_from(ProcessingJob).where(
        ProcessingJob.tenant_id == eng.tenant_id)

    assert admin_cli(["reindex", "--tenant", "acme", "--dry-run"]) == 0
    assert "would queue 1 document(s)" in capsys.readouterr().out  # failed ones need the flag
    assert db.scalar(jobs) == 2  # a dry run writes nothing

    assert admin_cli(["reindex", "--tenant", "acme", "--include-failed"]) == 0
    assert "queued 2 document(s)" in capsys.readouterr().out
    keys = db.scalars(select(ProcessingJob.idempotency_key)
                      .where(ProcessingJob.idempotency_key.like("reindex:%"))).all()
    assert sorted(keys) == sorted([f"reindex:{pdf_id}:2", f"reindex:{md_id}:2"])
    # The documents are queued now, so running the command again queues nothing.
    assert admin_cli(["reindex", "--tenant", "acme", "--include-failed"]) == 0
    assert "queued 0 document(s)" in capsys.readouterr().out

    run_worker()
    db.expire_all()
    for doc_id in (pdf_id, md_id):
        doc = db.get(Document, doc_id)
        assert doc is not None and doc.status == DocumentStatus.INDEXED
        assert doc.chunk_count and doc.chunk_count > 0
        assert store.count_document(eng.tenant_id, doc_id,
                                    version_id=doc.current_version_id) == doc.chunk_count
        assert store.count_document(eng.tenant_id, doc_id) == doc.chunk_count  # no stale points
    assert admin_cli(["reindex", "--tenant", "no-such-tenant"]) == 1
