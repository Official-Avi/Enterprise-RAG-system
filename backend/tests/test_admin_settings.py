"""Administration: members/roles, collection grants, audit log, tenant settings."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from rackflow.db.models import Role
from tests.conftest import Factory

pytestmark = pytest.mark.integration


def test_member_lifecycle_and_last_admin_guard(client: TestClient, factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    r = client.post("/api/v1/admin/users", headers=admin.headers,
                    json={"email": "New.Person@acme.example.com", "display_name": "New Person",
                          "role": "engineer"})
    assert r.status_code == 201, r.text
    body = r.json()
    temp = body["temporary_password"]
    assert temp and len(temp) >= 12
    uid = body["member"]["user_id"]
    assert body["member"]["email"] == "new.person@acme.example.com"

    # The new member can sign in with the one-time password.
    login = client.post("/api/v1/auth/login", json={
        "email": "new.person@acme.example.com", "password": temp, "mode": "token"})
    assert login.status_code == 200
    member_headers = {"Authorization": f"Bearer {login.json()['token']}"}

    assert client.post("/api/v1/admin/users", headers=admin.headers, json={
        "email": "new.person@acme.example.com", "display_name": "x",
        "role": "auditor"}).status_code == 409

    r = client.patch(f"/api/v1/admin/users/{uid}/roles", json={"role": "auditor"},
                     headers=admin.headers)
    assert r.status_code == 200 and r.json()["role"] == "auditor"
    me = client.get("/api/v1/auth/me", headers=member_headers).json()
    assert me["role"] == "auditor"  # role changes apply to existing sessions immediately

    # The only admin cannot demote or remove themselves.
    assert client.patch(f"/api/v1/admin/users/{admin.user_id}/roles", json={"role": "engineer"},
                        headers=admin.headers).json()["error"]["code"] == "LAST_ADMIN"
    assert client.delete(f"/api/v1/admin/users/{admin.user_id}",
                         headers=admin.headers).status_code == 409

    assert client.delete(f"/api/v1/admin/users/{uid}", headers=admin.headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=member_headers).status_code == 401


def test_admin_endpoints_are_admin_only_and_tenant_scoped(client: TestClient,
                                                          factory: Factory) -> None:
    acme_admin = factory.actor(Role.ORG_ADMIN, tenant="acme")
    globex_admin = factory.actor(Role.ORG_ADMIN, tenant="globex")
    engineer = factory.actor(Role.ENGINEER)
    auditor = factory.actor(Role.AUDITOR)
    assert client.get("/api/v1/admin/users", headers=engineer.headers).status_code == 403
    assert client.get("/api/v1/admin/users", headers=auditor.headers).status_code == 200
    assert client.post("/api/v1/admin/users", headers=auditor.headers, json={
        "email": "a@acme.example.com", "display_name": "a", "role": "org_admin"}).status_code == 403
    emails = {m["email"] for m in client.get("/api/v1/admin/users",
                                             headers=globex_admin.headers).json()["items"]}
    assert acme_admin.email not in emails
    # Cross-tenant member operations look like "not found".
    assert client.patch(f"/api/v1/admin/users/{acme_admin.user_id}/roles", json={"role": "auditor"},
                        headers=globex_admin.headers).status_code == 404


def test_collection_grants(client: TestClient, factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    eng = factory.actor(Role.ENGINEER)
    outsider = factory.actor(Role.ENGINEER, tenant="globex")
    cid = client.post("/api/v1/collections", json={"name": "Secret", "visibility": "restricted"},
                      headers=admin.headers).json()["id"]
    assert client.get(f"/api/v1/collections/{cid}", headers=eng.headers).status_code == 404

    r = client.put(f"/api/v1/collections/{cid}/permissions/{eng.user_id}",
                   json={"permission": "read"}, headers=admin.headers)
    assert r.status_code == 200 and r.json()["permission"] == "read"
    got = client.get(f"/api/v1/collections/{cid}", headers=eng.headers)
    assert got.status_code == 200 and got.json()["access_level"] == "read"
    # Read grant does not allow uploads or managing grants.
    assert client.post(f"/api/v1/collections/{cid}/documents", headers=eng.headers,
                       files=[("files", ("a.md", b"# a\n\ntext here"))]).status_code == 404
    assert client.get(f"/api/v1/collections/{cid}/permissions",
                      headers=eng.headers).status_code == 404
    # Grants cannot be given to users outside the workspace.
    assert client.put(f"/api/v1/collections/{cid}/permissions/{outsider.user_id}",
                      json={"permission": "read"}, headers=admin.headers).status_code == 404
    grants = client.get(f"/api/v1/collections/{cid}/permissions", headers=admin.headers).json()
    assert [g["email"] for g in grants] == [eng.email]

    assert client.delete(f"/api/v1/collections/{cid}/permissions/{eng.user_id}",
                         headers=admin.headers).status_code == 204
    assert client.get(f"/api/v1/collections/{cid}", headers=eng.headers).status_code == 404


def test_audit_log_records_and_scopes(client: TestClient, factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    auditor = factory.actor(Role.AUDITOR)
    engineer = factory.actor(Role.ENGINEER)
    other = factory.actor(Role.ORG_ADMIN, tenant="globex")
    client.post("/api/v1/collections", json={"name": "Audited"}, headers=admin.headers)
    events = client.get("/api/v1/admin/audit-events?action=collection",
                        headers=auditor.headers).json()["items"]
    assert events and events[0]["action"] == "collection.create"
    assert events[0]["actor_email"] == admin.email and events[0]["correlation_id"]
    assert client.get("/api/v1/admin/audit-events", headers=engineer.headers).status_code == 403
    foreign = client.get("/api/v1/admin/audit-events", headers=other.headers).json()["items"]
    assert all(e["actor_email"] != admin.email for e in foreign)
    login_events = client.get("/api/v1/admin/audit-events?action=auth.login",
                              headers=auditor.headers).json()["items"]
    assert login_events  # successful logins are audited in the tenant


def test_tenant_settings(client: TestClient, factory: Factory) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    eng = factory.actor(Role.ENGINEER)
    base = client.get("/api/v1/settings/tenant", headers=admin.headers).json()
    assert base["overrides"]["retrieval_top_k"] is None
    r = client.patch("/api/v1/settings/tenant", json={"retrieval_top_k": 3, "ocr_enabled": False},
                     headers=admin.headers)
    assert r.status_code == 200
    assert r.json()["effective"]["retrieval_top_k"] == 3
    assert r.json()["effective"]["ocr_enabled"] is False
    bad = client.patch("/api/v1/settings/tenant", json={"chunk_size_tokens": 100,
                                                        "chunk_overlap_tokens": 100},
                       headers=admin.headers)
    assert bad.status_code == 422
    reset = client.patch("/api/v1/settings/tenant", json={"retrieval_top_k": None},
                         headers=admin.headers).json()
    assert reset["overrides"]["retrieval_top_k"] is None
    assert reset["effective"]["retrieval_top_k"] == base["effective"]["retrieval_top_k"]
    assert client.patch("/api/v1/settings/tenant", json={"retrieval_top_k": 9},
                        headers=eng.headers).status_code == 403
    model = client.get("/api/v1/settings/model", headers=eng.headers).json()
    assert model["configured_via"] == "environment"
    assert "key" not in str(model).lower()
