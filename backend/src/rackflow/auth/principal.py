from __future__ import annotations

import uuid
from dataclasses import dataclass

from rackflow.auth.rbac import Permission, role_has
from rackflow.db.models import Role


@dataclass(frozen=True, slots=True)
class Principal:
    """The authenticated caller. `tenant_id` always comes from the verified session."""

    user_id: uuid.UUID
    tenant_id: uuid.UUID
    role: Role
    session_id: uuid.UUID | None
    email: str
    display_name: str

    def can(self, permission: Permission) -> bool:
        return role_has(self.role, permission)
