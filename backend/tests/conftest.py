"""Shared test fixtures.

Integration tests run against a real PostgreSQL database named by TEST_DATABASE_URL
(default: rackflow_test on 127.0.0.1). The schema is rebuilt with Alembic once per session and
all tables are truncated after each test. Parallel developers/agents should each use their own
TEST_DATABASE_URL so test runs never interfere.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://rackflow:rackflow@127.0.0.1:5432/rackflow_test"
)
os.environ["DATABASE_URL"] = TEST_DB
os.environ["APP_ENV"] = "test"
os.environ.setdefault("EMBEDDING_PROVIDER", "hash")
os.environ.setdefault("MODEL_PROVIDER", "extractive")
os.environ.setdefault("VECTOR_COLLECTION", f"rackflow_test_{uuid.uuid4().hex[:8]}")
os.environ["OBJECT_STORAGE_PATH"] = tempfile.mkdtemp(prefix="rackflow-objects-")

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from rackflow.core import ratelimit  # noqa: E402
from rackflow.core.config import get_settings  # noqa: E402
from rackflow.db.base import Base  # noqa: E402
from rackflow.db.models import Role  # noqa: E402
from rackflow.db.session import get_engine, get_sessionmaker  # noqa: E402

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_PASSWORD = "correct-horse-battery-staple"


@pytest.fixture(scope="session", autouse=True)
def _schema() -> Iterator[None]:
    get_settings.cache_clear()
    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    yield
    try:  # drop this session's throwaway Qdrant collection
        from rackflow.providers.vectorstore import get_vector_store

        store = get_vector_store()
        if store.client.collection_exists(store.collection):
            store.client.delete_collection(store.collection)
    except Exception as exc:  # noqa: BLE001 — Qdrant may not be running for unit-only runs
        print(f"qdrant cleanup skipped: {type(exc).__name__}")


@pytest.fixture(autouse=True)
def _clean_tables() -> Iterator[None]:
    yield
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with get_engine().begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    ratelimit.reset_all()


@pytest.fixture()
def db() -> Iterator[Session]:
    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client() -> Iterator[TestClient]:
    from rackflow.api.app import create_app

    with TestClient(create_app()) as c:
        yield c


@dataclass
class Actor:
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    email: str
    role: Role
    token: str

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


class Factory:
    """Creates tenants/users and logs them in through the real login endpoint."""

    def __init__(self, client: TestClient) -> None:
        self.client = client
        self.tenants: dict[str, uuid.UUID] = {}

    def actor(self, role: Role, tenant: str = "acme", email: str | None = None) -> Actor:
        from rackflow.cli import ensure_tenant, ensure_user
        from rackflow.db.session import session_scope

        email = email or f"{role.value}-{uuid.uuid4().hex[:6]}@{tenant}.example.com"
        with session_scope() as s:
            t = ensure_tenant(s, tenant, tenant.title())
            user, _ = ensure_user(s, email=email, name=email.split("@")[0],
                                  password=TEST_PASSWORD, tenant=t, role=role)
            tenant_id, user_id = t.id, user.id
        resp = self.client.post(
            "/api/v1/auth/login",
            json={"email": email, "password": TEST_PASSWORD, "tenant_slug": tenant,
                  "mode": "token"},
        )
        assert resp.status_code == 200, resp.text
        return Actor(user_id=user_id, tenant_id=tenant_id, email=email, role=role,
                     token=resp.json()["token"])


@pytest.fixture()
def factory(client: TestClient) -> Factory:
    return Factory(client)
