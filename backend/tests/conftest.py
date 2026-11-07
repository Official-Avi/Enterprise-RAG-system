"""Shared test fixtures.

Integration tests run against a real PostgreSQL database named by TEST_DATABASE_URL.

- Pytest reads it from the process environment only. A TEST_DATABASE_URL line in .env is NOT
  loaded, so export it first. Unset, it falls back to CI's database: rackflow_test on 127.0.0.1
  with CI's throwaway login, which a local PostgreSQL usually rejects.
- Every session DROPS the public schema of that database and rebuilds it with Alembic, and every
  test truncates all tables. So the database name must contain "test" (checked below), and it must
  never be the database the app runs on.
- Runs at the same time need separate databases, or they drop each other's schema. Give each one
  its own database and its own TEST_VECTOR_COLLECTION, which must start with "rackflow_test_":

    createdb rackflow_test_mine
    $env:TEST_DATABASE_URL = "postgresql+psycopg://user:pass@127.0.0.1:5432/rackflow_test_mine"
    $env:TEST_VECTOR_COLLECTION = "rackflow_test_mine"
"""

from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://rackflow:rackflow@127.0.0.1:5432/rackflow_test"
)
# Printable form for error messages: the password never reaches test output.
TEST_DB_SAFE = make_url(TEST_DB).render_as_string(hide_password=True)
if "test" not in (make_url(TEST_DB).database or "").lower():
    raise RuntimeError(
        f"refusing to run: tests drop the schema of {TEST_DB_SAFE}. "
        "TEST_DATABASE_URL must name a database with 'test' in its name."
    )
# Every test-relevant setting is FORCED, never setdefault: a developer shell that exports the live
# values (VECTOR_COLLECTION=rackflow_chunks, EMBEDDING_PROVIDER=fastembed, ...) must not leak into
# the suite. Overrides go through explicit TEST_* variables only.
TEST_COLLECTION_PREFIX = "rackflow_test_"
os.environ["DATABASE_URL"] = TEST_DB
os.environ["APP_ENV"] = "test"
os.environ["EMBEDDING_PROVIDER"] = os.environ.get("TEST_EMBEDDING_PROVIDER") or "hash"
os.environ["MODEL_PROVIDER"] = os.environ.get("TEST_MODEL_PROVIDER") or "extractive"
os.environ["VECTOR_COLLECTION"] = (
    os.environ.get("TEST_VECTOR_COLLECTION") or f"{TEST_COLLECTION_PREFIX}{uuid.uuid4().hex[:8]}"
)
os.environ["OBJECT_STORAGE_PATH"] = tempfile.mkdtemp(prefix="rackflow-objects-")
os.environ["DEMO_MODE"] = "false"  # a local .env may enable it; demo tests switch it on explicitly
if not os.environ["VECTOR_COLLECTION"].startswith(TEST_COLLECTION_PREFIX):
    raise RuntimeError(
        f"refusing to run: test vector collection must start with {TEST_COLLECTION_PREFIX!r}"
    )

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
    try:
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE"))
            conn.execute(text("CREATE SCHEMA public"))
    except OperationalError as exc:
        pytest.exit(
            f"cannot reach the test database {TEST_DB_SAFE}. Export TEST_DATABASE_URL with a login "
            f"that works, and create the database first (see tests/conftest.py). "
            f"{type(exc.orig).__name__}",
            returncode=2,
        )
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    yield
    try:  # drop this session's throwaway Qdrant collection
        from rackflow.providers.vectorstore import get_vector_store

        store = get_vector_store()
        # Second guard: never delete anything that is not unmistakably a test collection, even if
        # settings were changed mid-session.
        if not store.collection.startswith(TEST_COLLECTION_PREFIX):
            print(f"qdrant cleanup refused for non-test collection {store.collection!r}")
        elif store.client.collection_exists(store.collection):
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
