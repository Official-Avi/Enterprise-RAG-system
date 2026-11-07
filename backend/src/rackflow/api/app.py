"""FastAPI application factory. Run with:  uvicorn rackflow.api.app:create_app --factory"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError

from rackflow import __version__
from rackflow.api.routers import (
    admin,
    auth,
    chat,
    collections,
    documents,
    evaluation,
    health,
    infrastructure,
    jobs,
    models,
    operations,
    workspaces,
)
from rackflow.api.routers import settings as settings_router
from rackflow.audit import record_audit
from rackflow.auth.principal import Principal
from rackflow.auth.sessions import CSRF_HEADER
from rackflow.core.config import get_settings
from rackflow.core.errors import (
    ForbiddenError,
    RateLimitedError,
    error_body,
    install_error_handlers,
)
from rackflow.core.logging import configure_logging, correlation_id_var, new_correlation_id
from rackflow.core.ratelimit import denied_audit_limiter
from rackflow.db.session import session_scope

log = logging.getLogger("rackflow.api")
_CID_RE = re.compile(r"^[A-Za-z0-9\-]{8,64}$")

API_PREFIX = "/api/v1"

# Every router mounted under API_PREFIX (also used by the authentication release gate test).
ROUTER_MODULES = (health, auth, workspaces, collections, documents, jobs, operations, chat,
                  models, infrastructure, admin, evaluation, settings_router)


@asynccontextmanager
async def _lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Load the embedding model in the background at startup, so the first readiness probe does
    # not pay for it (and the first question does not either). Never blocks startup.
    health.embedding_probe.start()
    yield


def _audit_denied(request: Request, code: str) -> None:
    """Records a refused call in the caller's tenant log. Never changes the refusal itself.

    A refusal with no principal yet (a missing CSRF header) has no tenant to report to, and is
    only logged by the request middleware.
    """
    principal: Principal | None = getattr(request.state, "principal", None)
    if principal is None:
        return
    # The route template, not the URL: no IDs from another tenant, no query string.
    path = getattr(request.scope.get("route"), "path", request.url.path)
    try:
        denied_audit_limiter.hit(f"{principal.user_id}:{request.method}:{path}")
    except RateLimitedError:
        return
    try:
        with session_scope() as db:
            record_audit(db, action="auth.access_denied", resource_type="route", outcome="denied",
                         principal=principal,
                         metadata={"method": request.method, "path": path, "code": code})
    except SQLAlchemyError as exc:
        log.error("audit_write_failed", extra={"exc_type": type(exc).__name__})


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    is_prod = settings.app_env == "production"

    app = FastAPI(
        title="RackFlow AI API",
        version=__version__,
        docs_url=None if is_prod else f"{API_PREFIX}/docs",
        redoc_url=None,
        openapi_url=None if is_prod else f"{API_PREFIX}/openapi.json",
        lifespan=_lifespan,
    )
    install_error_handlers(app)

    @app.exception_handler(ForbiddenError)
    async def _forbidden(request: Request, exc: ForbiddenError) -> JSONResponse:
        await run_in_threadpool(_audit_denied, request, exc.code)
        return JSONResponse(error_body(exc.code, exc.message), status_code=exc.status_code)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization", CSRF_HEADER, "X-Request-ID"],
        expose_headers=["X-Correlation-ID", "Retry-After"],
    )

    @app.middleware("http")
    async def correlation_and_headers(request: Request, call_next: Any) -> Response:
        incoming = request.headers.get("x-request-id", "")
        cid = incoming if _CID_RE.match(incoming) else new_correlation_id()
        token = correlation_id_var.set(cid)
        start = time.perf_counter()
        try:
            response: Response = await call_next(request)
        finally:
            correlation_id_var.reset(token)
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        response.headers["X-Correlation-ID"] = cid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers.setdefault("Cache-Control", "no-store")
        if not request.url.path.endswith(("/docs", "/openapi.json")):
            response.headers["Content-Security-Policy"] = (
                "default-src 'none'; frame-ancestors 'none'"
            )
        log.info(
            "request",
            extra={
                "method": request.method,
                "path": request.url.path,  # IDs only in paths; no query strings logged
                "status": response.status_code,
                "duration_ms": elapsed_ms,
                "correlation_id": cid,
            },
        )
        return response

    for module in ROUTER_MODULES:
        app.include_router(module.router, prefix=API_PREFIX)

    # Unprefixed liveness alias for load balancers / orchestrator probes.
    app.add_api_route("/health/live", health.live, methods=["GET"], include_in_schema=False)
    return app
