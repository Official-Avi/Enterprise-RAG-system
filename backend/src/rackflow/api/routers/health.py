from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from rackflow import __version__
from rackflow.db.session import get_sessionmaker

router = APIRouter(prefix="/health", tags=["health"])
log = logging.getLogger(__name__)


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


@router.get("/ready")
def ready() -> JSONResponse:
    checks = {"database": _check_database(), "vector_store": _check_vector_store()}
    ok = all(checks.values())
    return JSONResponse(
        {"status": "ready" if ok else "not_ready", "checks": checks},
        status_code=200 if ok else 503,
    )
