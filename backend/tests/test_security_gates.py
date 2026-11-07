"""Release gates (SECURITY.md §8): every API route requires authentication, login is rate
limited, production configuration is enforced, and migrations round-trip cleanly."""

from __future__ import annotations

import re
import uuid

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url

from rackflow.auth.deps import get_principal
from rackflow.db.models import Role
from tests.conftest import TEST_DB, Factory

pytestmark = pytest.mark.integration

# Routes that are intentionally reachable without a session.
PUBLIC = {
    ("GET", "/api/v1/health/live"),
    ("GET", "/api/v1/health/ready"),
    ("POST", "/api/v1/auth/login"),
    ("GET", "/api/v1/auth/demo"),  # empty unless DEMO_MODE; tests in test_demo_login.py
    ("POST", "/api/v1/auth/demo"),
    ("GET", "/health/live"),
}


def _depends_on(dependant, target) -> bool:  # type: ignore[no-untyped-def]
    return any(d.call is target or _depends_on(d, target) for d in dependant.dependencies)


def _api_routes() -> list[tuple[str, APIRoute]]:
    """(full path, route) for every API route; uses the public router objects that the app
    mounts (FastAPI 0.16x no longer flattens included routers into `app.routes`)."""
    from rackflow.api.app import API_PREFIX, ROUTER_MODULES

    return [(API_PREFIX + r.path, r) for m in ROUTER_MODULES for r in m.router.routes
            if isinstance(r, APIRoute)]


def test_every_non_public_route_depends_on_authentication() -> None:
    unprotected = []
    for path, route in _api_routes():
        for method in route.methods - {"HEAD", "OPTIONS"}:
            if (method, path) in PUBLIC:
                continue
            if not _depends_on(route.dependant, get_principal):
                unprotected.append(f"{method} {path}")
    assert unprotected == [], f"routes without authentication: {unprotected}"
    assert len(_api_routes()) > 50  # guard against the check silently matching nothing


def test_every_non_public_route_rejects_anonymous_requests(client: TestClient) -> None:
    checked = 0
    for template, route in _api_routes():
        path = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), template)
        for method in route.methods - {"HEAD", "OPTIONS"}:
            if (method, template) in PUBLIC:
                continue
            response = client.request(method, path, json={})
            assert response.status_code == 401, f"{method} {template} -> {response.status_code}"
            assert "Traceback" not in response.text
            checked += 1
    assert checked > 50


def test_login_is_rate_limited(client: TestClient, factory: Factory) -> None:
    actor = factory.actor(Role.ENGINEER)  # its own login counts towards the same limit
    codes = [client.post("/api/v1/auth/login",
                         json={"email": actor.email, "password": "wrong-password!"}).status_code
             for _ in range(12)]
    assert codes[:9] == [401] * 9 and codes[9:] == [429] * 3


def test_rate_limited_responses_carry_retry_after(client: TestClient, factory: Factory) -> None:
    from rackflow.core.errors import RateLimitedError
    from rackflow.core.ratelimit import SlidingWindowLimiter

    limiter = SlidingWindowLimiter(limit=2, window_seconds=30)
    limiter.hit("k")
    limiter.hit("k")
    with pytest.raises(RateLimitedError) as caught:
        limiter.hit("k")
    assert caught.value.retry_after is not None and 1 <= caught.value.retry_after <= 30

    actor = factory.actor(Role.ENGINEER)  # its own login is hit 1 of 10
    responses = [client.post("/api/v1/auth/login",
                             json={"email": actor.email, "password": "wrong-password!"})
                 for _ in range(10)]
    assert responses[-1].status_code == 429
    assert 1 <= int(responses[-1].headers["Retry-After"]) <= 60
    assert "Retry-After" not in responses[0].headers


def test_error_responses_are_safe(client: TestClient) -> None:
    r = client.get(f"/api/v1/documents/{uuid.uuid4()}")
    body = r.json()
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message", "correlation_id"}
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert "default-src 'none'" in r.headers["Content-Security-Policy"]
    assert r.headers["Cache-Control"] == "no-store"


def test_production_configuration_is_enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    from pydantic import ValidationError

    from rackflow.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(app_env="production", cookie_secure=False)
    with pytest.raises(ValidationError):
        Settings(app_env="production", cookie_secure=True, embedding_provider="hash")
    with pytest.raises(ValidationError):
        Settings(model_provider="anthropic", model_api_key=None)

    from rackflow.api import app as app_module

    prod = Settings(app_env="production", cookie_secure=True, embedding_provider="fastembed")
    monkeypatch.setattr(app_module, "get_settings", lambda: prod)
    with TestClient(app_module.create_app()) as c:
        assert c.get("/api/v1/docs").status_code == 404  # no public API docs in production
        assert c.get("/api/v1/openapi.json").status_code == 404


def test_migrations_round_trip() -> None:
    """upgrade head → downgrade base → upgrade head on a scratch database."""
    from alembic import command
    from alembic.config import Config

    from tests.conftest import BACKEND_DIR

    url = make_url(TEST_DB)
    scratch = f"{url.database}_migrations"
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{scratch}"'))
        conn.execute(text(f'CREATE DATABASE "{scratch}"'))
    engine = create_engine(url.set(database=scratch))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    try:
        for target in ("head", "base", "head"):
            with engine.begin() as conn:
                cfg.attributes["connection"] = conn
                if target == "base":
                    command.downgrade(cfg, "base")
                else:
                    command.upgrade(cfg, "head")
            tables = set(inspect(engine).get_table_names())
            if target == "base":
                assert tables <= {"alembic_version"}
            else:
                assert {"documents", "processing_jobs", "racks", "audit_events"} <= tables
    finally:
        engine.dispose()
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{scratch}"'))
        admin.dispose()
