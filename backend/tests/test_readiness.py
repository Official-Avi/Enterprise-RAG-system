"""Readiness and liveness (Finding 32).

A lost Qdrant collection recreated empty by ensure_collection must not make /health/ready green
while PostgreSQL still holds chunks of live indexed documents. A fresh deployment (nothing indexed,
collection missing or empty) is ready. /health/live never touches a dependency.

Every Qdrant test uses its own throwaway "rackflow_test_readiness_*" collection and deletes it."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient
from qdrant_client.http.exceptions import UnexpectedResponse

from rackflow.db.models import Chunk, Collection, Document, DocumentStatus, DocumentVersion, Role
from rackflow.db.session import session_scope
from rackflow.providers.interfaces import VectorRecord
from rackflow.providers.vectorstore import QdrantVectorStore, get_vector_store
from tests.conftest import Factory

DIMENSION = 8
READY_KEYS = {"database", "vector_store", "vector_collection", "vector_collection_consistent",
              "embeddings"}


@pytest.fixture()
def store(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[QdrantVectorStore]:
    """The app's vector store pointed at a throwaway collection, which does not exist yet."""
    from rackflow.api.routers.health import embedding_probe

    embedding_probe.check()  # let the startup warm-up finish so it cannot race the test
    s = get_vector_store()
    name = f"rackflow_test_readiness_{uuid.uuid4().hex[:8]}"
    monkeypatch.setattr(s, "collection", name)
    monkeypatch.setattr(s, "_ready", False)
    yield s
    assert name.startswith("rackflow_test_")  # never delete anything else
    if s.client.collection_exists(name):
        s.client.delete_collection(name)


def _indexed_document(factory: Factory, *, status: DocumentStatus = DocumentStatus.INDEXED,
                      deleted: bool = False, tenant: str = "acme") -> uuid.UUID:
    """A document with one chunk in PostgreSQL, as the worker leaves it after indexing."""
    from datetime import UTC, datetime

    eng = factory.actor(Role.ENGINEER, tenant=tenant)
    with session_scope() as s:
        col = Collection(tenant_id=eng.tenant_id, name=f"c-{uuid.uuid4().hex[:6]}",
                         created_by=eng.user_id)
        s.add(col)
        s.flush()
        doc = Document(tenant_id=eng.tenant_id, collection_id=col.id, filename="a.md",
                       file_type="md", mime_type="text/markdown", size_bytes=1,
                       content_hash=uuid.uuid4().hex * 2,
                       storage_key="tenants/x/documents/y/original", status=status, warnings=[],
                       chunk_count=1,
                       deleted_at=datetime.now(UTC) if deleted else None)
        s.add(doc)
        s.flush()
        ver = DocumentVersion(tenant_id=eng.tenant_id, document_id=doc.id, version=1,
                              content_hash=doc.content_hash, pipeline_version="t",
                              status="indexed")
        s.add(ver)
        s.flush()
        doc.current_version_id = ver.id
        s.add(Chunk(tenant_id=eng.tenant_id, collection_id=col.id, document_id=doc.id,
                    document_version_id=ver.id, chunk_index=0, text="secret tenant text",
                    token_count=3, content_hash="0" * 64, metadata_json={}))
        return eng.tenant_id


def _ready(client: TestClient) -> tuple[int, dict[str, Any]]:
    r = client.get("/api/v1/health/ready")
    return r.status_code, r.json()


# ------------------------------------------------------------------ first boot


@pytest.mark.integration
@pytest.mark.qdrant
def test_first_boot_without_collection_is_ready(
        client: TestClient, store: QdrantVectorStore) -> None:
    code, body = _ready(client)
    assert code == 200, body
    assert body == {"status": "ready", "checks": dict.fromkeys(READY_KEYS, True)}


@pytest.mark.integration
@pytest.mark.qdrant
def test_first_boot_with_empty_collection_is_ready(
        client: TestClient, store: QdrantVectorStore) -> None:
    store.ensure_collection(DIMENSION)  # what the worker does on first index
    code, body = _ready(client)
    assert code == 200, body
    assert body["checks"]["vector_collection_consistent"] is True


# ------------------------------------------------------------------ data loss


@pytest.mark.integration
@pytest.mark.qdrant
def test_missing_collection_with_indexed_chunks_is_not_ready(
        client: TestClient, factory: Factory, store: QdrantVectorStore) -> None:
    _indexed_document(factory)
    code, body = _ready(client)
    assert code == 503
    assert body["status"] == "not_ready"
    assert body["checks"]["vector_collection"] is False
    assert body["checks"]["vector_collection_consistent"] is False
    assert body["checks"]["database"] is True and body["checks"]["vector_store"] is True


@pytest.mark.integration
@pytest.mark.qdrant
def test_collection_recreated_empty_with_indexed_chunks_is_not_ready(
        client: TestClient, factory: Factory, store: QdrantVectorStore) -> None:
    """The finding: ensure_collection silently recreates the lost collection empty."""
    _indexed_document(factory)
    store.ensure_collection(DIMENSION)
    code, body = _ready(client)
    assert code == 503
    assert body["checks"]["vector_collection"] is True  # it exists...
    assert body["checks"]["vector_collection_consistent"] is False  # ...but holds nothing

    # Rebuilding the vectors (reindex) makes it ready again.
    store.upsert([VectorRecord(id=uuid.uuid4(), vector=[1.0] + [0.0] * (DIMENSION - 1),
                               payload={"tenant_id": "t"})])
    code, body = _ready(client)
    assert code == 200, body
    assert body["checks"]["vector_collection_consistent"] is True


@pytest.mark.integration
@pytest.mark.qdrant
@pytest.mark.parametrize(("status", "deleted"), [
    (DocumentStatus.DELETED, True),
    (DocumentStatus.DELETING, True),
    (DocumentStatus.INDEXED, True),  # soft-deleted, chunk cleanup still pending
    (DocumentStatus.PROCESSING, False),  # vectors not written yet
    (DocumentStatus.FAILED, False),
])
def test_chunks_that_need_no_vectors_keep_an_empty_collection_ready(
        client: TestClient, factory: Factory, store: QdrantVectorStore,
        status: DocumentStatus, deleted: bool) -> None:
    _indexed_document(factory, status=status, deleted=deleted)
    store.ensure_collection(DIMENSION)
    code, body = _ready(client)
    assert code == 200, body


@pytest.mark.integration
@pytest.mark.qdrant
def test_not_ready_response_carries_no_tenant_data(
        client: TestClient, factory: Factory, store: QdrantVectorStore) -> None:
    tenant_id = _indexed_document(factory, tenant="globex")
    store.ensure_collection(DIMENSION)
    r = client.get("/api/v1/health/ready")
    assert r.status_code == 503
    body = r.json()
    assert set(body) == {"status", "checks"}
    assert set(body["checks"]) == READY_KEYS
    assert all(isinstance(v, bool) for v in body["checks"].values())
    for leaked in (str(tenant_id), "globex", "secret tenant text", store.collection):
        assert leaked not in r.text


# ------------------------------------------------------------------ cost


@pytest.mark.integration
@pytest.mark.qdrant
def test_ready_makes_one_qdrant_request(
        client: TestClient, factory: Factory, store: QdrantVectorStore,
        monkeypatch: pytest.MonkeyPatch) -> None:
    _indexed_document(factory)
    store.ensure_collection(DIMENSION)
    calls: list[str] = []

    class Spy:
        def __init__(self, inner: Any) -> None:
            self.inner = inner

        def __getattr__(self, name: str) -> Any:
            calls.append(name)
            return getattr(self.inner, name)

    monkeypatch.setattr(store, "client", Spy(store.client))
    monkeypatch.setattr(store, "probe_client", Spy(store.probe_client))
    _ready(client)
    assert calls == ["count"]


def test_point_count_reports_missing_collection_as_none() -> None:
    probe = MagicMock()
    probe.count.side_effect = UnexpectedResponse(404, "Not Found", b"{}", httpx.Headers())
    assert QdrantVectorStore(MagicMock(), "c", probe_client=probe).point_count() is None
    probe.count.side_effect = None
    probe.count.return_value.count = 7
    assert QdrantVectorStore(MagicMock(), "c", probe_client=probe).point_count() == 7
    kwargs = probe.count.call_args.kwargs
    assert kwargs["exact"] is False and kwargs["timeout"] is not None


def test_point_count_raises_on_other_errors() -> None:
    probe = MagicMock()
    probe.count.side_effect = UnexpectedResponse(500, "Boom", b"{}", httpx.Headers())
    with pytest.raises(UnexpectedResponse):
        QdrantVectorStore(MagicMock(), "c", probe_client=probe).point_count()


@pytest.mark.integration
def test_point_count_uses_short_timeout_probe_client() -> None:
    from rackflow.providers.vectorstore import PROBE_TIMEOUT_SECONDS

    s = get_vector_store()
    assert s.probe_client is not s.client
    assert PROBE_TIMEOUT_SECONDS <= 5
    # Private attribute of qdrant-client's HTTP transport; skip rather than fail if it moves.
    timeout = getattr(getattr(s.probe_client, "_client", None), "_timeout", None)
    if timeout is None:
        pytest.skip("qdrant-client no longer exposes its transport timeout")
    assert timeout == PROBE_TIMEOUT_SECONDS


# ------------------------------------------------------------------ dependencies down


@pytest.mark.integration
def test_live_needs_no_dependency_and_ready_reports_them_down(
        client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from rackflow.api.routers import health
    from rackflow.providers import vectorstore

    def down(*_: Any, **__: Any) -> Any:
        raise ConnectionError("dependency down")

    monkeypatch.setattr(health, "get_sessionmaker", down)
    monkeypatch.setattr(vectorstore, "get_vector_store", down)
    monkeypatch.setattr(health.embedding_probe, "check", lambda *a, **k: False)
    for path in ("/api/v1/health/live", "/health/live"):
        r = client.get(path)
        assert r.status_code == 200 and r.json()["status"] == "ok"
    code, body = _ready(client)
    assert code == 503
    assert body["checks"] == dict.fromkeys(READY_KEYS, False)
