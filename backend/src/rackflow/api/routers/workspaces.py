"""`Workspace` in the API/UI is the `Tenant` entity (DECISIONS.md ADR-008)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.auth.deps import get_principal
from rackflow.auth.principal import Principal
from rackflow.db.models import Tenant, TenantMembership
from rackflow.db.session import get_db

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    role: str
    current: bool


@router.get("", response_model=list[WorkspaceOut])
def list_workspaces(
    principal: Principal = Depends(get_principal), db: Session = Depends(get_db)
) -> list[WorkspaceOut]:
    rows = db.execute(
        select(Tenant, TenantMembership.role)
        .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
        .where(TenantMembership.user_id == principal.user_id, Tenant.status == "active")
        .order_by(Tenant.name)
    ).all()
    return [
        WorkspaceOut(id=t.id, name=t.name, slug=t.slug, role=role.value,
                     current=t.id == principal.tenant_id)
        for t, role in rows
    ]
