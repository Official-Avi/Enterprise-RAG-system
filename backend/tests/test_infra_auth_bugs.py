"""Regressions: infrastructure deletes, refused calls and failed sign-ins in the audit log, CORS."""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient

from rackflow.cli import ensure_tenant
from rackflow.core import ratelimit
from rackflow.db.models import NodeResource, Rack, Role, StateSource, User, Workload
from rackflow.db.session import session_scope
from tests.conftest import TEST_PASSWORD, Actor, Factory

pytestmark = pytest.mark.integration
INFRA = "/api/v1/infrastructure"
WRONG_PASSWORD = "wrong-horse-zebra-paperclip"


def _audit(client: TestClient, reader: Actor, query: str) -> list[dict[str, Any]]:
    resp = client.get(f"/api/v1/admin/audit-events?{query}", headers=reader.headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["items"]


def _login(client: TestClient, email: str, password: str, slug: str | None = None) -> int:
    return client.post("/api/v1/auth/login", json={
        "email": email, "password": password, "tenant_slug": slug, "mode": "token",
    }).status_code


# ---------------------------------------------------------------- infrastructure deletes


def test_delete_workload_node_rack_in_order_and_audited(
    client: TestClient, factory: Factory,
) -> None:
    op = factory.actor(Role.OPERATOR)
    auditor = factory.actor(Role.AUDITOR)
    rid = client.post(f"{INFRA}/racks", headers=op.headers, json={"name": "r1"}).json()["id"]
    nid = client.post(f"{INFRA}/nodes", headers=op.headers,
                      json={"name": "n1", "rack_id": rid}).json()["id"]
    wid = client.post(f"{INFRA}/workloads", headers=op.headers, json={
        "name": "w1", "workload_type": "api", "node_id": nid}).json()["id"]

    # Blocked from the outside in, each naming what to do first.
    rack = client.delete(f"{INFRA}/racks/{rid}", headers=op.headers)
    assert (rack.status_code, rack.json()["error"]["code"]) == (409, "RACK_NOT_EMPTY")
    node = client.delete(f"{INFRA}/nodes/{nid}", headers=op.headers)
    assert (node.status_code, node.json()["error"]["code"]) == (409, "NODE_HAS_WORKLOADS")

    assert client.delete(f"{INFRA}/workloads/{wid}", headers=op.headers).status_code == 204
    assert client.get(f"{INFRA}/workloads", headers=op.headers).json() == {"items": []}
    assert client.delete(f"{INFRA}/nodes/{nid}", headers=op.headers).status_code == 204
    assert client.get(f"{INFRA}/nodes", headers=op.headers).json() == {"items": []}
    assert client.delete(f"{INFRA}/racks/{rid}", headers=op.headers).status_code == 204
    assert client.get(f"{INFRA}/racks/{rid}", headers=op.headers).status_code == 404

    # A deleted record stays identifiable in the log.
    expected = {("infra.workload.delete", wid, "w1"), ("infra.node.delete", nid, "n1"),
                ("infra.rack.delete", rid, "r1")}
    events = _audit(client, auditor, "action=infra&outcome=success")
    deletes = {(e["action"], e["resource_id"], e["metadata"]["name"]) for e in events
               if e["action"].endswith(".delete")}
    assert deletes == expected
    assert all(e["metadata"]["state_source"] == "manual" for e in events
               if e["action"].endswith(".delete"))


def test_delete_needs_permission_and_stays_in_tenant(client: TestClient, factory: Factory) -> None:
    op = factory.actor(Role.OPERATOR)
    eng = factory.actor(Role.ENGINEER)
    outsider = factory.actor(Role.OPERATOR, tenant="globex")
    nid = client.post(f"{INFRA}/nodes", headers=op.headers, json={"name": "n1"}).json()["id"]
    wid = client.post(f"{INFRA}/workloads", headers=op.headers, json={
        "name": "w1", "workload_type": "api"}).json()["id"]

    for path in (f"nodes/{nid}", f"workloads/{wid}"):
        assert client.delete(f"{INFRA}/{path}", headers=eng.headers).status_code == 403
        assert client.delete(f"{INFRA}/{path}", headers=outsider.headers).status_code == 404
        assert client.delete(f"{INFRA}/{path}").status_code == 401
    assert len(client.get(f"{INFRA}/nodes", headers=op.headers).json()["items"]) == 1
    assert len(client.get(f"{INFRA}/workloads", headers=op.headers).json()["items"]) == 1


def test_simulated_records_can_be_deleted(client: TestClient, factory: Factory) -> None:
    op = factory.actor(Role.OPERATOR)
    nid = client.post(f"{INFRA}/nodes", headers=op.headers, json={
        "name": "sim", "state_source": "simulated"}).json()["id"]
    assert client.delete(f"{INFRA}/nodes/{nid}", headers=op.headers).status_code == 204


def test_integration_records_cannot_be_deleted(client: TestClient, factory: Factory) -> None:
    op = factory.actor(Role.OPERATOR)
    source = StateSource.INTEGRATION
    with session_scope() as s:
        rack = Rack(tenant_id=op.tenant_id, name="live", environment="production",
                    state_source=source, metadata_json={})
        node = NodeResource(tenant_id=op.tenant_id, name="live", resource_type="server",
                            state_source=source, metadata_json={})
        work = Workload(tenant_id=op.tenant_id, name="live", workload_type="api",
                        state_source=source, resource_request={}, resource_assignment={})
        s.add_all([rack, node, work])
        s.flush()
        paths = [f"racks/{rack.id}", f"nodes/{node.id}", f"workloads/{work.id}"]
    for path in paths:
        resp = client.delete(f"{INFRA}/{path}", headers=op.headers)
        assert (resp.status_code, resp.json()["error"]["code"]) == (409, "INTEGRATION_MANAGED")
        assert "cannot be deleted" in resp.json()["error"]["message"]


def test_rack_rename_to_a_taken_name_is_a_conflict(client: TestClient, factory: Factory) -> None:
    op = factory.actor(Role.OPERATOR)
    rid = client.post(f"{INFRA}/racks", headers=op.headers, json={"name": "a"}).json()["id"]
    client.post(f"{INFRA}/racks", headers=op.headers, json={"name": "b"})
    taken = client.patch(f"{INFRA}/racks/{rid}", headers=op.headers, json={"name": "b"})
    assert (taken.status_code, taken.json()["error"]["code"]) == (409, "RACK_NAME_TAKEN")
    # Sending its own name back, as an edit form may, is not a clash.
    assert client.patch(f"{INFRA}/racks/{rid}", headers=op.headers,
                        json={"name": "a"}).status_code == 200


# -------------------------------------------------------------- refused calls in the audit log


def test_refused_call_is_audited_as_denied(client: TestClient, factory: Factory) -> None:
    auditor = factory.actor(Role.AUDITOR)
    eng = factory.actor(Role.ENGINEER)
    rid = uuid.uuid4()
    resp = client.patch(f"{INFRA}/racks/{rid}?secret=abc", headers=eng.headers, json={"name": "x"})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "FORBIDDEN" and resp.json()["error"]["correlation_id"]

    events = _audit(client, auditor, "outcome=denied")
    assert len(events) == 1
    event = events[0]
    assert event["action"] == "auth.access_denied"  # listed under the page's "auth" filter
    assert event["actor_email"] == eng.email
    assert event["correlation_id"] == resp.headers["X-Correlation-ID"]
    # The route template only: neither the ID nor the query string is stored.
    meta = event["metadata"]
    assert (meta["method"], meta["code"]) == ("PATCH", "FORBIDDEN")
    assert meta["path"].endswith("/infrastructure/racks/{rack_id}")
    assert str(rid) not in json.dumps(event) and "secret" not in json.dumps(event)


def test_refusal_is_only_visible_in_the_callers_tenant(
    client: TestClient, factory: Factory,
) -> None:
    eng = factory.actor(Role.ENGINEER)
    other = factory.actor(Role.AUDITOR, tenant="globex")
    assert client.get("/api/v1/admin/audit-events", headers=eng.headers).status_code == 403
    assert _audit(client, other, "outcome=denied") == []


def test_repeated_refusals_are_capped_but_still_refused(
    client: TestClient, factory: Factory,
) -> None:
    auditor = factory.actor(Role.AUDITOR)
    eng = factory.actor(Role.ENGINEER)
    cap = ratelimit.denied_audit_limiter.limit
    for _ in range(cap + 3):
        assert client.post(f"{INFRA}/racks", headers=eng.headers,
                           json={"name": "x"}).status_code == 403
    assert len(_audit(client, auditor, "outcome=denied")) == cap
    # Another route is counted separately.
    assert client.post(f"{INFRA}/nodes", headers=eng.headers,
                       json={"name": "x"}).status_code == 403
    assert len(_audit(client, auditor, "outcome=denied")) == cap + 1


def test_missing_csrf_is_still_refused_without_a_tenant_row(
    client: TestClient, factory: Factory,
) -> None:
    auditor = factory.actor(Role.AUDITOR)
    resp = client.post("/api/v1/auth/login", json={
        "email": auditor.email, "password": TEST_PASSWORD, "mode": "cookie"})
    assert resp.status_code == 200
    refused = client.post(f"{INFRA}/racks", json={"name": "x"})  # the cookie, with no CSRF header
    assert (refused.status_code, refused.json()["error"]["code"]) == (403, "CSRF_REQUIRED")
    client.cookies.clear()
    assert _audit(client, auditor, "outcome=denied") == []


# ------------------------------------------------------------ rejected sign-ins in the audit log


def test_wrong_password_reaches_the_tenant_log_without_the_password(
    client: TestClient, factory: Factory,
) -> None:
    auditor = factory.actor(Role.AUDITOR)
    eng = factory.actor(Role.ENGINEER)
    assert _login(client, eng.email, WRONG_PASSWORD) == 401

    events = _audit(client, auditor, "outcome=failure")
    assert len(events) == 1
    event = events[0]
    assert event["action"] == "auth.login" and event["resource_id"] == str(eng.user_id)
    assert event["actor_user_id"] is None  # nobody was authenticated
    assert event["metadata"] == {"reason": "wrong_password", "email": eng.email}
    assert WRONG_PASSWORD not in json.dumps(event)
    assert _audit(client, auditor, "outcome=denied") == []


def test_wrong_password_is_not_shown_to_other_tenants(client: TestClient, factory: Factory) -> None:
    eng = factory.actor(Role.ENGINEER)
    other = factory.actor(Role.AUDITOR, tenant="globex")
    assert _login(client, eng.email, WRONG_PASSWORD) == 401
    assert _audit(client, other, "outcome=failure") == []


def test_unknown_account_goes_to_the_requested_tenant_and_never_stores_the_address(
    client: TestClient, factory: Factory,
) -> None:
    acme = factory.actor(Role.AUDITOR)
    globex = factory.actor(Role.AUDITOR, tenant="globex")
    typed = "nobody@elsewhere.example.com"

    assert _login(client, typed, WRONG_PASSWORD, slug="acme") == 401
    events = _audit(client, acme, "outcome=failure")
    assert len(events) == 1 and events[0]["metadata"] == {"reason": "unknown_account"}
    assert events[0]["resource_id"] is None and typed not in json.dumps(events[0])
    assert _audit(client, globex, "outcome=failure") == []

    # Two tenants and none asked for: it belongs to neither.
    assert _login(client, typed, WRONG_PASSWORD) == 401
    assert len(_audit(client, acme, "outcome=failure")) == 1
    assert _audit(client, globex, "outcome=failure") == []


def test_unknown_account_goes_to_the_only_tenant(client: TestClient, factory: Factory) -> None:
    auditor = factory.actor(Role.AUDITOR)
    assert _login(client, "nobody@elsewhere.example.com", WRONG_PASSWORD) == 401
    assert [e["metadata"] for e in _audit(client, auditor, "outcome=failure")] == [
        {"reason": "unknown_account"}]


def test_disabled_account_with_the_right_password_is_denied(
    client: TestClient, factory: Factory,
) -> None:
    auditor = factory.actor(Role.AUDITOR)
    eng = factory.actor(Role.ENGINEER)
    with session_scope() as s:
        user = s.get(User, eng.user_id)
        assert user is not None
        user.status = "disabled"
    assert _login(client, eng.email, TEST_PASSWORD) == 401
    assert [e["metadata"]["reason"] for e in _audit(client, auditor, "outcome=denied")] == [
        "account_disabled"]


def test_right_password_for_a_tenant_the_user_is_not_in_is_denied(
    client: TestClient, factory: Factory,
) -> None:
    auditor = factory.actor(Role.AUDITOR)
    eng = factory.actor(Role.ENGINEER)
    other = factory.actor(Role.AUDITOR, tenant="globex")
    assert _login(client, eng.email, TEST_PASSWORD, slug="globex") == 401
    assert [e["metadata"]["reason"] for e in _audit(client, auditor, "outcome=denied")] == [
        "not_a_member_of_tenant"]
    assert _audit(client, other, "outcome=denied") == []  # nothing about acme's user


def test_user_in_two_tenants_is_reported_to_the_one_asked_for_else_both(
    client: TestClient, factory: Factory,
) -> None:
    from rackflow.cli import ensure_user

    acme = factory.actor(Role.AUDITOR)
    globex = factory.actor(Role.AUDITOR, tenant="globex")
    email = "both@example.com"
    with session_scope() as s:
        for slug in ("acme", "globex"):
            ensure_user(s, email=email, name="both", password=TEST_PASSWORD,
                        tenant=ensure_tenant(s, slug, slug.title()), role=Role.ENGINEER)

    assert _login(client, email, WRONG_PASSWORD, slug="globex") == 401
    assert _audit(client, acme, "outcome=failure") == []
    assert len(_audit(client, globex, "outcome=failure")) == 1

    assert _login(client, email, WRONG_PASSWORD) == 401
    assert len(_audit(client, acme, "outcome=failure")) == 1
    assert len(_audit(client, globex, "outcome=failure")) == 2


def test_login_failure_filters_by_outcome_success_stays_separate(
    client: TestClient, factory: Factory,
) -> None:
    auditor = factory.actor(Role.AUDITOR)
    assert _login(client, auditor.email, WRONG_PASSWORD) == 401
    assert {e["outcome"] for e in _audit(client, auditor, "action=auth.login")} == {
        "success", "failure"}
    assert all(e["outcome"] == "success" for e in _audit(client, auditor, "outcome=success"))


# ------------------------------------------------------------------------- rate limit and CORS


def test_too_many_sign_ins_answer_429_with_retry_after(client: TestClient) -> None:
    email = "nobody@elsewhere.example.com"
    statuses = [client.post("/api/v1/auth/login", json={"email": email, "password": "x"})
                for _ in range(ratelimit.login_limiter.limit + 1)]
    assert statuses[-1].status_code == 429
    assert 1 <= int(statuses[-1].headers["Retry-After"]) <= 60


def test_cors_allows_put_and_exposes_retry_after(monkeypatch: pytest.MonkeyPatch) -> None:
    from rackflow.api.app import create_app
    from rackflow.core.config import get_settings

    origin = "https://console.example.com"
    monkeypatch.setattr(get_settings(), "web_origin", origin)
    with TestClient(create_app()) as c:
        # collections.py grants permissions with PUT, which a browser preflights.
        preflight = c.options(
            f"/api/v1/collections/{uuid.uuid4()}/permissions/{uuid.uuid4()}",
            headers={"Origin": origin, "Access-Control-Request-Method": "PUT"},
        )
        assert preflight.status_code == 200, preflight.text
        assert "PUT" in preflight.headers["Access-Control-Allow-Methods"]
        actual = c.get("/api/v1/auth/demo", headers={"Origin": origin})
        assert "Retry-After" in actual.headers["Access-Control-Expose-Headers"]
