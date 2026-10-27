from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from rackflow.core.config import get_settings
from rackflow.db.models import AuthSession

SESSION_COOKIE = "rf_session"
CSRF_HEADER = "X-RackFlow-CSRF"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(
    db: Session, *, user_id: uuid.UUID, tenant_id: uuid.UUID
) -> tuple[str, AuthSession]:
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    row = AuthSession(
        user_id=user_id,
        tenant_id=tenant_id,
        token_hash=hash_token(token),
        expires_at=now + timedelta(hours=get_settings().session_ttl_hours),
        last_seen_at=now,
    )
    db.add(row)
    db.flush()
    return token, row


def find_active_session(db: Session, token: str) -> AuthSession | None:
    now = datetime.now(UTC)
    return db.scalar(
        select(AuthSession).where(
            AuthSession.token_hash == hash_token(token),
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > now,
        )
    )


def revoke_session(db: Session, session_id: uuid.UUID) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


def revoke_user_sessions(db: Session, user_id: uuid.UUID) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
