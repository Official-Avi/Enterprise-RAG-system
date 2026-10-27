"""FastAPI application factory. Run with:  uvicorn rackflow.api.app:create_app --factory"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

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
from rackflow.auth.sessions import CSRF_HEADER
from rackflow.core.config import get_settings
from rackflow.core.errors import install_error_handlers
from rackflow.core.logging import configure_logging, correlation_id_var, new_correlation_id

log = logging.getLogger("rackflow.api")
_CID_RE = re.compile(r"^[A-Za-z0-9\-]{8,64}$")

API_PREFIX = "/api/v1"


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
    )
    install_error_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "Authorization", CSRF_HEADER, "X-Request-ID"],
        expose_headers=["X-Correlation-ID"],
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

    for module in (
        health,
        auth,
        workspaces,
        collections,
        documents,
        jobs,
        operations,
        chat,
        models,
        infrastructure,
        admin,
        evaluation,
        settings_router,
    ):
        app.include_router(module.router, prefix=API_PREFIX)

    # Unprefixed liveness alias for load balancers / orchestrator probes.
    app.add_api_route("/health/live", health.live, methods=["GET"], include_in_schema=False)
    return app
