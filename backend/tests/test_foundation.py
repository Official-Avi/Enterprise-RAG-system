"""Foundation tests: health, authentication, sessions, CSRF, RBAC and tenant isolation for
collections."""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from rackflow.api.routers.health import EmbeddingProbe
from rackflow.auth.rbac import ROLE_PERMISSIONS, Permission
from rackflow.db.models import Collection, Document, DocumentStatus, Role
from rackflow.db.session import session_scope
from tests.conftest import TEST_PASSWORD, Factory

pytestmark = pytest.mark.integration


def test_health_live(client: TestClient) -> None:
    r = client.get("/api/v1/health/live")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "X-Correlation-ID" in r.headers
    assert r.headers["X-Content-Type-Options"] == "nosniff"


@pytest.fixture()
def probe(client: TestClient) -> Iterator[EmbeddingProbe]:
    from rackflow.api.routers.health import embedding_probe

    embedding_probe.check()  # let the startup warm-up finish so it cannot race the test
    embedding_probe.reset()
    yield embedding_probe
    embedding_probe.reset()


@pytest.mark.qdrant
@pytest.mark.usefixtures("probe")
def test_health_ready_checks_every_dependency(client: TestClient) -> None:
    r = client.get("/api/v1/health/ready")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ready", "checks": {
        "database": True, "vector_store": True, "vector_collection": True, "embeddings": True}}


@pytest.mark.qdrant
@pytest.mark.usefixtures("probe")
def test_health_ready_fails_when_embeddings_cannot_load(
        client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """BUG-04: a broken embedding runtime (ENV-1) must make the API not ready."""
    from rackflow.providers import embeddings

    def broken() -> None:
        raise ImportError("DLL load failed", name="onnxruntime")

    monkeypatch.setattr(embeddings, "get_embedding_provider", broken)
    r = client.get("/api/v1/health/ready")
    assert r.status_code == 503
    assert r.json()["status"] == "not_ready"
    assert r.json()["checks"]["embeddings"] is False
    assert r.json()["checks"]["database"] is True


@pytest.mark.qdrant
@pytest.mark.usefixtures("probe")
def test_health_ready_fails_when_indexed_vectors_are_gone(
        client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch) -> None:
    """BUG-04: PostgreSQL lists indexed documents but the vector collection is missing (BUG-01).
    A fresh deployment with nothing indexed yet is still ready."""
    from rackflow.providers.vectorstore import get_vector_store

    monkeypatch.setattr(get_vector_store(), "collection",
                        f"rackflow_test_absent_{uuid.uuid4().hex[:8]}")
    assert client.get("/api/v1/health/ready").json()["checks"]["vector_collection"] is True

    eng = factory.actor(Role.ENGINEER)
    with session_scope() as s:
        col = Collection(tenant_id=eng.tenant_id, name="c", created_by=eng.user_id)
        s.add(col)
        s.flush()
        s.add(Document(tenant_id=eng.tenant_id, collection_id=col.id, filename="a.md",
                       file_type="md", mime_type="text/markdown", size_bytes=1,
                       content_hash="0" * 64, storage_key="tenants/x/documents/y/original",
                       status=DocumentStatus.INDEXED, warnings=[]))
    r = client.get("/api/v1/health/ready")
    assert r.status_code == 503
    assert r.json()["checks"]["vector_collection"] is False


def test_protected_endpoint_requires_auth(client: TestClient) -> None:
    r = client.get("/api/v1/collections")
    assert r.status_code == 401
    body = r.json()["error"]
    assert body["code"] == "UNAUTHENTICATED"
    assert body["correlation_id"]


def test_login_wrong_password_is_generic(client: TestClient, factory: Factory) -> None:
    actor = factory.actor(Role.ENGINEER)
    bad = client.post("/api/v1/auth/login", json={"email": actor.email, "password": "nope-nope"})
    unknown = client.post("/api/v1/auth/login",
                          json={"email": "ghost@acme.example.com", "password": "nope-nope"})
    assert bad.status_code == unknown.status_code == 401
    assert bad.json()["error"]["message"] == unknown.json()["error"]["message"]


def test_cookie_session_requires_csrf_header_for_writes(client: TestClient,
                                                        factory: Factory) -> None:
    actor = factory.actor(Role.ENGINEER)
    r = client.post("/api/v1/auth/login",
                    json={"email": actor.email, "password": TEST_PASSWORD})
    assert r.status_code == 200
    assert r.json()["token"] is None  # cookie mode never exposes the token
    assert client.get("/api/v1/auth/me").status_code == 200
    no_csrf = client.post("/api/v1/collections", json={"name": "c1"})
    assert no_csrf.status_code == 403
    assert no_csrf.json()["error"]["code"] == "CSRF_REQUIRED"
    ok = client.post("/api/v1/collections", json={"name": "c1"},
                     headers={"X-RackFlow-CSRF": "1"})
    assert ok.status_code == 201


def test_logout_revokes_session(client: TestClient, factory: Factory) -> None:
    actor = factory.actor(Role.ENGINEER)
    assert client.post("/api/v1/auth/logout", headers=actor.headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=actor.headers).status_code == 401


def test_me_reports_role_permissions(client: TestClient, factory: Factory) -> None:
    auditor = factory.actor(Role.AUDITOR)
    me = client.get("/api/v1/auth/me", headers=auditor.headers).json()
    assert me["role"] == "auditor"
    assert Permission.DOCUMENT_READ_CONTENT.value not in me["permissions"]
    assert set(me["permissions"]) == {p.value for p in ROLE_PERMISSIONS[Role.AUDITOR]}


def test_auditor_cannot_create_collection(client: TestClient, factory: Factory) -> None:
    auditor = factory.actor(Role.AUDITOR)
    r = client.post("/api/v1/collections", json={"name": "x"}, headers=auditor.headers)
    assert r.status_code == 403


def test_collection_tenant_isolation(client: TestClient, factory: Factory) -> None:
    acme = factory.actor(Role.ORG_ADMIN, tenant="acme")
    globex = factory.actor(Role.ORG_ADMIN, tenant="globex")
    created = client.post("/api/v1/collections", json={"name": "Runbooks"},
                          headers=acme.headers)
    assert created.status_code == 201
    cid = created.json()["id"]

    assert client.get("/api/v1/collections", headers=globex.headers).json() == []
    foreign = client.get(f"/api/v1/collections/{cid}", headers=globex.headers)
    missing = client.get("/api/v1/collections/00000000-0000-0000-0000-000000000000",
                         headers=globex.headers)
    # Foreign and nonexistent are indistinguishable (FR-005).
    assert foreign.status_code == missing.status_code == 404
    assert foreign.json()["error"]["code"] == missing.json()["error"]["code"]
    assert client.patch(f"/api/v1/collections/{cid}", json={"name": "pwned"},
                        headers=globex.headers).status_code == 404
    assert client.delete(f"/api/v1/collections/{cid}",
                         headers=globex.headers).status_code == 404


def test_restricted_collection_hidden_from_other_engineers(client: TestClient,
                                                           factory: Factory) -> None:
    owner = factory.actor(Role.ENGINEER)
    other = factory.actor(Role.ENGINEER)
    admin = factory.actor(Role.ORG_ADMIN)
    r = client.post("/api/v1/collections", json={"name": "HR", "visibility": "restricted"},
                    headers=owner.headers)
    cid = r.json()["id"]
    assert client.get(f"/api/v1/collections/{cid}", headers=other.headers).status_code == 404
    assert all(c["id"] != cid for c in
               client.get("/api/v1/collections", headers=other.headers).json())
    assert client.get(f"/api/v1/collections/{cid}", headers=owner.headers).status_code == 200
    assert client.get(f"/api/v1/collections/{cid}", headers=admin.headers).status_code == 200


def test_duplicate_collection_name_conflicts(client: TestClient, factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    assert client.post("/api/v1/collections", json={"name": "Dup"},
                       headers=admin.headers).status_code == 201
    r = client.post("/api/v1/collections", json={"name": "Dup"}, headers=admin.headers)
    assert r.status_code == 409


def test_validation_errors_do_not_echo_input(client: TestClient, factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    secret = "s3cr3t-value-" + "x" * 300
    r = client.post("/api/v1/collections", json={"name": secret}, headers=admin.headers)
    assert r.status_code == 422
    assert secret not in r.text
