from __future__ import annotations

import logging
import threading
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import select, text

from rackflow import __version__
from rackflow.db.models import Document, DocumentStatus
from rackflow.db.session import get_sessionmaker

router = APIRouter(prefix="/health", tags=["health"])
log = logging.getLogger(__name__)

EMBED_PROBE_TIMEOUT_SECONDS = 5.0
EMBED_PROBE_SUCCESS_TTL_SECONDS = 60.0


@router.get("/live")
def live() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


def _check_database() -> bool:
    try:
        with get_sessionmaker()() as db:
            db.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001 — readiness reports, never raises
        log.warning("readiness_database_unavailable")
        return False


def _check_vector_store() -> bool:
    try:
        from rackflow.providers.vectorstore import get_vector_store

        return bool(get_vector_store().health())
    except Exception:  # noqa: BLE001
        log.warning("readiness_vector_store_unavailable")
        return False


def _check_vector_collection() -> bool:
    """The configured collection exists, or nothing is indexed yet. The worker creates the
    collection on the first index, so a fresh deployment is ready; a missing collection while
    PostgreSQL lists indexed documents means the vectors were lost (rebuild with
    `rackflow-admin reindex`)."""
    try:
        from rackflow.providers.vectorstore import get_vector_store

        if get_vector_store().collection_exists():
            return True
        with get_sessionmaker()() as db:
            indexed = db.scalar(select(Document.id).where(
                Document.status == DocumentStatus.INDEXED).limit(1))
        if indexed is not None:
            log.warning("readiness_vector_collection_missing")
        return indexed is None
    except Exception:  # noqa: BLE001
        log.warning("readiness_vector_collection_unavailable")
        return False


class EmbeddingProbe:
    """Builds the embedding provider and embeds a tiny string in a daemon thread, so a hung
    model load can never block a readiness request beyond `timeout`. Success is cached for
    EMBED_PROBE_SUCCESS_TTL_SECONDS; failures are not cached. A probe still running after a
    timed-out request is reused by the next request instead of starting another."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ok_until = 0.0
        self._running: threading.Event | None = None

    def start(self) -> threading.Event | None:
        """Start a probe unless one is running or a recent success is cached (non-blocking)."""
        with self._lock:
            if time.monotonic() < self._ok_until:
                return None
            if self._running is None:
                self._running = threading.Event()
                threading.Thread(target=self._run, args=(self._running,), daemon=True,
                                 name="readiness-embedding-probe").start()
            return self._running

    def check(self, timeout: float = EMBED_PROBE_TIMEOUT_SECONDS) -> bool:
        running = self.start()
        if running is not None:
            running.wait(timeout)
        return time.monotonic() < self._ok_until

    def reset(self) -> None:
        with self._lock:
            self._ok_until = 0.0

    def _run(self, done: threading.Event) -> None:
        ok = False
        try:
            from rackflow.providers.embeddings import get_embedding_provider

            ok = len(get_embedding_provider().embed_query("readiness probe")) > 0
        except Exception as exc:  # noqa: BLE001 — includes ImportError from a broken runtime
            log.warning("readiness_embeddings_unavailable",
                        extra={"exc_type": type(exc).__name__})
        with self._lock:
            if ok:
                self._ok_until = time.monotonic() + EMBED_PROBE_SUCCESS_TTL_SECONDS
            self._running = None
        done.set()


embedding_probe = EmbeddingProbe()


@router.get("/ready")
def ready() -> JSONResponse:
    database = _check_database()
    vector_store = _check_vector_store()
    checks = {
        "database": database,
        "vector_store": vector_store,
        "vector_collection": database and vector_store and _check_vector_collection(),
        "embeddings": embedding_probe.check(),
    }
    ok = all(checks.values())
    return JSONResponse(
        {"status": "ready" if ok else "not_ready", "checks": checks},
        status_code=200 if ok else 503,
    )
