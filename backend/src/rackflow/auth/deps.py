"""FastAPI dependencies for authentication and permission checks.

Usage in routers:
    principal: Principal = Depends(require(Permission.CHAT_USE))
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.auth.sessions import CSRF_HEADER, SESSION_COOKIE, find_active_session
from rackflow.core.errors import ForbiddenError, UnauthenticatedError
from rackflow.db.models import TenantMembership, User
from rackflow.db.session import get_db

_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_TOUCH_INTERVAL = timedelta(minutes=5)


def _extract_token(request: Request) -> tuple[str | None, bool]:
    """Returns (token, from_cookie)."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None, False
    cookie = request.cookies.get(SESSION_COOKIE)
    return (cookie, True) if cookie else (None, False)


def get_principal(request: Request, db: Session = Depends(get_db)) -> Principal:
    token, from_cookie = _extract_token(request)
    if not token:
        raise UnauthenticatedError()
    session = find_active_session(db, token)
    if session is None:
        raise UnauthenticatedError(code="SESSION_INVALID", message="Your session has expired.")

    # Browsers attach cookies automatically, so state-changing cookie requests must carry a
    # custom header, which cross-site forms cannot send without a CORS preflight.
    if from_cookie and request.method not in _SAFE_METHODS and not request.headers.get(CSRF_HEADER):
        raise ForbiddenError(code="CSRF_REQUIRED", message="Missing CSRF header.")

    row = db.execute(
        select(User, TenantMembership)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .where(
            User.id == session.user_id,
            TenantMembership.tenant_id == session.tenant_id,
            User.status == "active",
        )
    ).first()
    if row is None:  # user disabled or membership removed since login
        raise UnauthenticatedError(code="SESSION_INVALID", message="Your session has expired.")
    user, membership = row

    now = datetime.now(UTC)
    if session.last_seen_at is None or now - session.last_seen_at > _TOUCH_INTERVAL:
        session.last_seen_at = now
        db.commit()

    principal = Principal(
        user_id=user.id,
        tenant_id=membership.tenant_id,
        role=membership.role,
        session_id=session.id,
        email=user.email,
        display_name=user.display_name,
    )
    request.state.principal = principal
    return principal


def require(*permissions: Permission) -> Callable[..., Principal]:
    def dependency(principal: Principal = Depends(get_principal)) -> Principal:
        for perm in permissions:
            if not principal.can(perm):
                raise ForbiddenError()
        return principal

    return dependency
