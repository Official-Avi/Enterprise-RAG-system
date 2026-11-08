from __future__ import annotations

import logging
import threading
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import exists, select, text

from rackflow import __version__
from rackflow.db.models import Chunk, Document, DocumentStatus
from rackflow.db.session import get_sessionmaker

router = APIRouter(prefix="/health", tags=["health"])
log = logging.getLogger(__name__)

EMBED_PROBE_TIMEOUT_SECONDS = 5.0
EMBED_PROBE_SUCCESS_TTL_SECONDS = 60.0
# Bounds the readiness query so a locked or overloaded database fails the probe quickly.
DB_PROBE_STATEMENT_TIMEOUT_MS = 2000


@router.get("/live")
async def live() -> dict[str, str]:
    # Liveness touches no dependency and runs on the event loop, not the threadpool: a slow
    # database, Qdrant or embedding load (or readiness probes waiting on them) can never make
    # the orchestrator restart a healthy process.
    return {"status": "ok", "version": __version__}


# Is there at least one chunk of a live, indexed document? Those chunks must have vectors.
# EXISTS stops at the first row (chunks.document_id is indexed), and returns a single boolean:
# no tenant, document or chunk data leaves this query.
_LIVE_INDEXED_CHUNKS = select(exists().where(
    Chunk.document_id == Document.id,
    Document.status == DocumentStatus.INDEXED,
    Document.deleted_at.is_(None),
))


def _live_indexed_chunks_exist() -> bool | None:
    """One bounded query. None when the database cannot answer."""
    try:
        with get_sessionmaker()() as db, db.begin():
            db.execute(text(f"SET LOCAL statement_timeout = {DB_PROBE_STATEMENT_TIMEOUT_MS}"))
            return bool(db.scalar(_LIVE_INDEXED_CHUNKS))
    except Exception:  # noqa: BLE001 — readiness reports, never raises
        log.warning("readiness_database_unavailable")
        return None


def _vector_point_count() -> tuple[bool, int | None]:
    """(reachable, points): one count request with a short timeout. points is None when the
    configured collection does not exist."""
    try:
        from rackflow.providers.vectorstore import get_vector_store

        return True, get_vector_store().point_count()
    except Exception:  # noqa: BLE001 — includes timeouts and connection errors
        log.warning("readiness_vector_store_unavailable")
        return False, None


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
    """Booleans only: the response never carries counts, names or tenant data.

    vector_collection: the configured collection exists, or nothing is indexed yet (the worker
    creates it on the first index, so a fresh deployment is ready).
    vector_collection_consistent: when PostgreSQL holds chunks of live indexed documents, the
    collection exists and is not empty. A collection lost and recreated empty (ensure_collection
    does that on the next upload or reindex) would otherwise look healthy while search returns
    nothing. Recover with `rackflow-admin reindex`."""
    indexed = _live_indexed_chunks_exist()
    vector_store, points = _vector_point_count()
    database = indexed is not None
    both = database and vector_store
    collection = both and (points is not None or not indexed)
    consistent = both and (not indexed or bool(points))
    if both and not consistent:
        log.warning("readiness_vector_collection_inconsistent",
                    extra={"collection_missing": points is None})
    checks = {
        "database": database,
        "vector_store": vector_store,
        "vector_collection": collection,
        "vector_collection_consistent": consistent,
        "embeddings": embedding_probe.check(),
    }
    ok = all(checks.values())
    return JSONResponse(
        {"status": "ready" if ok else "not_ready", "checks": checks},
        status_code=200 if ok else 503,
    )
