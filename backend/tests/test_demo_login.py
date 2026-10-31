"""One-click demo login: off by default, never in production, no passwords on the wire."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from rackflow.db.models import Role
from tests.conftest import Factory

pytestmark = pytest.mark.integration


@pytest.fixture()
def demo_on(monkeypatch: pytest.MonkeyPatch) -> None:
    from rackflow.api.routers import auth
    from rackflow.core.config import get_settings

    patched = get_settings().model_copy(update={"demo_mode": True})
    monkeypatch.setattr(auth, "get_settings", lambda: patched)


def test_demo_is_disabled_by_default(client: TestClient, factory: Factory) -> None:
    factory.actor(Role.ENGINEER, email="engineer@acme.example.com")
    assert client.get("/api/v1/auth/demo").json() == {"enabled": False, "personas": []}
    assert client.post("/api/v1/auth/demo", json={"persona": "engineer"}).status_code == 404


@pytest.mark.usefixtures("demo_on")
def test_demo_lists_only_seeded_personas_without_secrets(
    client: TestClient, factory: Factory
) -> None:
    factory.actor(Role.ENGINEER, email="engineer@acme.example.com")
    body = client.get("/api/v1/auth/demo").json()
    assert body["enabled"] is True
    assert [p["key"] for p in body["personas"]] == ["engineer"]  # others are not seeded
    assert "password" not in str(body).lower()


@pytest.mark.usefixtures("demo_on")
def test_demo_login_sets_a_session_cookie(client: TestClient, factory: Factory) -> None:
    factory.actor(Role.ENGINEER, email="engineer@acme.example.com")
    client.cookies.clear()
    r = client.post("/api/v1/auth/demo", json={"persona": "engineer"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "engineer" and r.json()["token"] is None
    assert "rf_session" in r.cookies
    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200 and me.json()["email"] == "engineer@acme.example.com"


@pytest.mark.usefixtures("demo_on")
def test_demo_login_rejects_unknown_or_unseeded_personas(client: TestClient) -> None:
    assert client.post("/api/v1/auth/demo", json={"persona": "nobody"}).status_code == 404
    assert client.post("/api/v1/auth/demo", json={"persona": "admin"}).status_code == 404


def test_demo_mode_is_refused_in_production() -> None:
    from pydantic import ValidationError

    from rackflow.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(app_env="production", cookie_secure=True, demo_mode=True)


def test_demo_persona_copy_fits_the_card() -> None:
    """UI spec §4.1: a summary, at most 3 "can" lines and 2 "can't" lines; admin has no limits."""
    from rackflow.auth.demo import DEMO_PERSONAS, find_persona

    assert [p.key for p in DEMO_PERSONAS] == ["engineer", "operator", "admin", "auditor"]
    for p in DEMO_PERSONAS:
        assert p.summary and 1 <= len(p.can) <= 3 and len(p.cannot) <= 2
    admin = find_persona("admin")
    assert admin is not None and admin.cannot == ()
