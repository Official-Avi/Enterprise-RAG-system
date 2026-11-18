"""Admin member guards: shared demo accounts (DEMO_MODE) and the last-admin rule (Finding 64)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from rackflow.db.models import AuditEvent, Role, TenantMembership
from rackflow.db.session import get_sessionmaker
from tests.conftest import Factory

pytestmark = pytest.mark.integration


@pytest.fixture()
def demo_on(monkeypatch: pytest.MonkeyPatch) -> None:
    from rackflow.api.routers import admin
    from rackflow.core.config import get_settings

    patched = get_settings().model_copy(update={"demo_mode": True})
    monkeypatch.setattr(admin, "get_settings", lambda: patched)


def _role(db: Session, tenant_id: object, user_id: object) -> Role | None:
    db.expire_all()
    return db.scalar(select(TenantMembership.role).where(
        TenantMembership.tenant_id == tenant_id, TenantMembership.user_id == user_id))


def _audits(db: Session, action: str) -> int:
    return db.scalar(select(func.count()).select_from(AuditEvent)
                     .where(AuditEvent.action == action)) or 0


@pytest.mark.usefixtures("demo_on")
@pytest.mark.parametrize("email", ["engineer@acme.example.com", "auditor@acme.example.com"])
def test_demo_persona_role_and_membership_are_protected(
    client: TestClient, factory: Factory, db: Session, email: str
) -> None:
    admin = factory.actor(Role.ORG_ADMIN)  # a non-demo admin of the same workspace
    target = factory.actor(Role.ENGINEER, email=email)

    r = client.patch(f"/api/v1/admin/users/{target.user_id}/roles", json={"role": "org_admin"},
                     headers=admin.headers)
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "DEMO_ACCOUNT_PROTECTED"

    r = client.delete(f"/api/v1/admin/users/{target.user_id}", headers=admin.headers)
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "DEMO_ACCOUNT_PROTECTED"

    # Nothing was written: role, membership and session are intact and no audit event exists.
    assert _role(db, target.tenant_id, target.user_id) == Role.ENGINEER
    assert _audits(db, "member.role_change") == 0
    assert _audits(db, "member.remove") == 0
    assert client.get("/api/v1/auth/me", headers=target.headers).status_code == 200


@pytest.mark.usefixtures("demo_on")
def test_demo_admin_cannot_demote_or_remove_itself_even_with_another_admin(
    client: TestClient, factory: Factory, db: Session
) -> None:
    demo_admin = factory.actor(Role.ORG_ADMIN, email="admin@acme.example.com")
    factory.actor(Role.ORG_ADMIN)  # another admin, so LAST_ADMIN would not apply
    r = client.patch(f"/api/v1/admin/users/{demo_admin.user_id}/roles",
                     json={"role": "engineer"}, headers=demo_admin.headers)
    assert r.json()["error"]["code"] == "DEMO_ACCOUNT_PROTECTED"
    r = client.delete(f"/api/v1/admin/users/{demo_admin.user_id}", headers=demo_admin.headers)
    assert r.json()["error"]["code"] == "DEMO_ACCOUNT_PROTECTED"
    assert _role(db, demo_admin.tenant_id, demo_admin.user_id) == Role.ORG_ADMIN


@pytest.mark.usefixtures("demo_on")
def test_seed_demo_accounts_outside_the_personas_are_protected(
    client: TestClient, factory: Factory
) -> None:
    # globex accounts come from `seed-demo` (cli.DEMO_USERS) but are not landing-page personas.
    admin = factory.actor(Role.ORG_ADMIN, tenant="globex")
    target = factory.actor(Role.ENGINEER, tenant="globex", email="engineer@globex.example.com")
    r = client.delete(f"/api/v1/admin/users/{target.user_id}", headers=admin.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "DEMO_ACCOUNT_PROTECTED"


@pytest.mark.usefixtures("demo_on")
def test_demo_mode_still_allows_managing_ordinary_members(
    client: TestClient, factory: Factory, db: Session
) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    member = factory.actor(Role.ENGINEER)
    r = client.patch(f"/api/v1/admin/users/{member.user_id}/roles", json={"role": "auditor"},
                     headers=admin.headers)
    assert r.status_code == 200 and r.json()["role"] == "auditor"
    assert client.delete(f"/api/v1/admin/users/{member.user_id}",
                         headers=admin.headers).status_code == 204
    assert _role(db, member.tenant_id, member.user_id) is None


@pytest.mark.usefixtures("demo_on")
def test_demo_guard_does_not_reveal_accounts_in_other_tenants(
    client: TestClient, factory: Factory
) -> None:
    globex_admin = factory.actor(Role.ORG_ADMIN, tenant="globex")
    acme_persona = factory.actor(Role.ENGINEER, email="engineer@acme.example.com")
    r = client.delete(f"/api/v1/admin/users/{acme_persona.user_id}", headers=globex_admin.headers)
    assert r.status_code == 404  # not a member here: "not found", not "protected"


def test_demo_accounts_are_ordinary_when_demo_mode_is_off(
    client: TestClient, factory: Factory, db: Session
) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    target = factory.actor(Role.ENGINEER, email="engineer@acme.example.com")
    r = client.patch(f"/api/v1/admin/users/{target.user_id}/roles", json={"role": "auditor"},
                     headers=admin.headers)
    assert r.status_code == 200 and r.json()["role"] == "auditor"
    assert client.delete(f"/api/v1/admin/users/{target.user_id}",
                         headers=admin.headers).status_code == 204
    assert _role(db, target.tenant_id, target.user_id) is None


def test_admin_cannot_demote_or_remove_themselves_as_last_admin(
    client: TestClient, factory: Factory, db: Session
) -> None:
    admin = factory.actor(Role.ORG_ADMIN)
    factory.actor(Role.ENGINEER)
    for role in ("engineer", "operator", "auditor"):
        r = client.patch(f"/api/v1/admin/users/{admin.user_id}/roles", json={"role": role},
                         headers=admin.headers)
        assert r.status_code == 409 and r.json()["error"]["code"] == "LAST_ADMIN"
    r = client.delete(f"/api/v1/admin/users/{admin.user_id}", headers=admin.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "LAST_ADMIN"
    assert _role(db, admin.tenant_id, admin.user_id) == Role.ORG_ADMIN
    assert _audits(db, "member.role_change") == 0 and _audits(db, "member.remove") == 0
    # Re-asserting the admin role is not a demotion.
    assert client.patch(f"/api/v1/admin/users/{admin.user_id}/roles", json={"role": "org_admin"},
                        headers=admin.headers).status_code == 200


def test_admin_can_step_down_while_another_admin_remains(
    client: TestClient, factory: Factory, db: Session
) -> None:
    first = factory.actor(Role.ORG_ADMIN)
    second = factory.actor(Role.ORG_ADMIN)
    r = client.patch(f"/api/v1/admin/users/{first.user_id}/roles", json={"role": "engineer"},
                     headers=first.headers)
    assert r.status_code == 200 and r.json()["role"] == "engineer"
    # The remaining admin is now the last one and cannot leave.
    r = client.delete(f"/api/v1/admin/users/{second.user_id}", headers=second.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "LAST_ADMIN"
    # The other admins in another tenant do not count.
    factory.actor(Role.ORG_ADMIN, tenant="globex")
    r = client.patch(f"/api/v1/admin/users/{second.user_id}/roles", json={"role": "auditor"},
                     headers=second.headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "LAST_ADMIN"
    assert _role(db, second.tenant_id, second.user_id) == Role.ORG_ADMIN


def test_admin_count_locks_admin_memberships(factory: Factory) -> None:
    """Concurrent demotions serialise on the admin rows instead of both passing the check."""
    from rackflow.api.routers.admin import _admin_count

    admin = factory.actor(Role.ORG_ADMIN)
    factory.actor(Role.ORG_ADMIN)
    make = get_sessionmaker()
    first, second = make(), make()
    try:
        assert _admin_count(first, admin.tenant_id) == 2  # holds the row locks
        second.execute(text("SET LOCAL lock_timeout = '500ms'"))
        with pytest.raises(OperationalError, match="lock"):
            _admin_count(second, admin.tenant_id)
    finally:
        second.rollback()
        first.rollback()
        second.close()
        first.close()
