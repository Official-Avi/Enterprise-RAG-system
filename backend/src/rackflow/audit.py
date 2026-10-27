"""Audit trail for security-relevant actions. Metadata must be IDs/counts only — no secrets,
passwords, document text, prompts or answers."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from rackflow.auth.principal import Principal
from rackflow.core.logging import get_correlation_id
from rackflow.db.models import AuditEvent

_FORBIDDEN_KEYS = {"password", "token", "secret", "api_key", "content", "text", "prompt", "answer"}


def record_audit(
    db: Session,
    *,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID | str | None = None,
    outcome: str = "success",
    principal: Principal | None = None,
    tenant_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditEvent:
    safe = {k: v for k, v in (metadata or {}).items() if k.lower() not in _FORBIDDEN_KEYS}
    event = AuditEvent(
        tenant_id=principal.tenant_id if principal else tenant_id,
        actor_user_id=principal.user_id if principal else actor_user_id,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        outcome=outcome,
        correlation_id=get_correlation_id(),
        safe_metadata=safe,
    )
    db.add(event)
    return event
