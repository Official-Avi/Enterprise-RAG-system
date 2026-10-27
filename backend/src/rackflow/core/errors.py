"""Application errors rendered in the standard API error shape (see Docs/API_SPEC.md).

Messages here are shown to users: never include stack traces, file paths, SQL, secrets, or
whether a resource exists in another tenant.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from rackflow.core.logging import get_correlation_id

log = logging.getLogger(__name__)


class AppError(Exception):
    status_code = 400
    code = "BAD_REQUEST"
    message = "The request could not be processed."

    def __init__(self, message: str | None = None, *, code: str | None = None,
                 status_code: int | None = None) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.status_code = status_code or self.status_code
        super().__init__(self.message)


class NotFoundError(AppError):
    """Also used for resources in other tenants or without permission, to avoid existence leaks."""

    status_code = 404
    code = "NOT_FOUND"
    message = "The requested resource could not be found."


class UnauthenticatedError(AppError):
    status_code = 401
    code = "UNAUTHENTICATED"
    message = "Authentication is required."


class ForbiddenError(AppError):
    status_code = 403
    code = "FORBIDDEN"
    message = "You do not have permission to perform this action."


class ConflictError(AppError):
    status_code = 409
    code = "CONFLICT"
    message = "The request conflicts with the current state of the resource."


class ValidationFailedError(AppError):
    status_code = 422
    code = "VALIDATION_FAILED"
    message = "The request is invalid."


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "PAYLOAD_TOO_LARGE"
    message = "The uploaded file exceeds the allowed size."


class RateLimitedError(AppError):
    status_code = 429
    code = "RATE_LIMITED"
    message = "Too many requests. Please retry later."


class ServiceUnavailableError(AppError):
    status_code = 503
    code = "SERVICE_UNAVAILABLE"
    message = "A required service is temporarily unavailable."


def error_body(code: str, message: str) -> dict[str, object]:
    return {"error": {"code": code, "message": message, "correlation_id": get_correlation_id()}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, exc.message), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Report field locations and messages only; never echo submitted values back.
        fields = [
            {"loc": [str(p) for p in err.get("loc", ())], "msg": err.get("msg", "invalid")}
            for err in exc.errors()
        ]
        body = error_body("VALIDATION_FAILED", "The request is invalid.")
        body["error"]["fields"] = fields  # type: ignore[index]
        return JSONResponse(body, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}.get(exc.status_code, "HTTP_ERROR")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(error_body(code, message), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled_error", extra={"exc_type": type(exc).__name__})
        return JSONResponse(
            error_body("INTERNAL_ERROR", "An unexpected error occurred."), status_code=500
        )
