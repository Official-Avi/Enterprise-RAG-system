"""Workspace administration: members, roles and the audit log (tenant-scoped).

Email invitations are deferred (no mail service): admins create members directly and receive a
one-time temporary password when a new account is created (Docs/DECISIONS.md ADR-006).
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from rackflow.api.pagination import decode_cursor, encode_cursor
from rackflow.audit import record_audit
from rackflow.auth.deps import require
from rackflow.auth.passwords import MIN_PASSWORD_LENGTH, hash_password
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.errors import ConflictError, NotFoundError
from rackflow.db.models import (
    AuditEvent,
    AuthSession,
    CollectionPermission,
    Role,
    TenantMembership,
    User,
)
from rackflow.db.session import get_db

router = APIRouter(prefix="/admin", tags=["admin"])


class MemberOut(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str
    role: Role
    status: str
    joined_at: datetime
    last_login_at: datetime | None


class MemberList(BaseModel):
    items: list[MemberOut]


class CreateMemberIn(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=200)
    role: Role
    password: str | None = Field(default=None, min_length=MIN_PASSWORD_LENGTH, max_length=512)


class CreateMemberOut(BaseModel):
    member: MemberOut
    temporary_password: str | None  # shown once, only when a new account was created


class RoleIn(BaseModel):
    role: Role


class AuditOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    actor_user_id: uuid.UUID | None
    actor_email: str | None
    action: str
    resource_type: str
    resource_id: str | None
    outcome: str
    correlation_id: str | None
    metadata: dict[str, object]


class AuditPage(BaseModel):
    items: list[AuditOut]
    next_cursor: str | None


def _members(
    db: Session, tenant_id: uuid.UUID, user_id: uuid.UUID | None = None
) -> list[MemberOut]:
    last_login = (select(AuthSession.user_id, func.max(AuthSession.created_at).label("last"))
                  .where(AuthSession.tenant_id == tenant_id).group_by(AuthSession.user_id)
                  .subquery())
    stmt = (select(User, TenantMembership, last_login.c.last)
            .join(TenantMembership, TenantMembership.user_id == User.id)
            .outerjoin(last_login, last_login.c.user_id == User.id)
            .where(TenantMembership.tenant_id == tenant_id))
    if user_id is not None:
        stmt = stmt.where(User.id == user_id)
    rows = db.execute(stmt.order_by(User.email)).all()
    return [MemberOut(user_id=u.id, email=u.email, display_name=u.display_name, role=m.role,
                      status=u.status, joined_at=m.created_at, last_login_at=last)
            for u, m, last in rows]


def _membership(db: Session, principal: Principal, user_id: uuid.UUID) -> TenantMembership:
    m = db.scalar(select(TenantMembership).where(TenantMembership.tenant_id == principal.tenant_id,
                                                 TenantMembership.user_id == user_id))
    if m is None:
        raise NotFoundError(code="MEMBER_NOT_FOUND", message="The member could not be found.")
    return m


def _admin_count(db: Session, tenant_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).select_from(TenantMembership).where(
        TenantMembership.tenant_id == tenant_id,
        TenantMembership.role == Role.ORG_ADMIN)) or 0


@router.get("/users", response_model=MemberList)
def list_members(
    principal: Principal = Depends(require(Permission.USER_READ)),
    db: Session = Depends(get_db),
) -> MemberList:
    return MemberList(items=_members(db, principal.tenant_id))


@router.post("/users", response_model=CreateMemberOut, status_code=201)
def create_member(
    body: CreateMemberIn,
    principal: Principal = Depends(require(Permission.USER_MANAGE)),
    db: Session = Depends(get_db),
) -> CreateMemberOut:
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    temporary: str | None = None
    if user is None:
        temporary = body.password or secrets.token_urlsafe(12)
        user = User(email=email, display_name=body.display_name.strip(),
                    password_hash=hash_password(temporary))
        db.add(user)
        db.flush()
        if body.password:
            temporary = None  # the admin chose it; never echo it back
    elif db.scalar(select(TenantMembership.id).where(
            TenantMembership.tenant_id == principal.tenant_id,
            TenantMembership.user_id == user.id)):
        raise ConflictError(code="MEMBER_EXISTS", message="This user is already a member.")
    db.add(TenantMembership(tenant_id=principal.tenant_id, user_id=user.id, role=body.role))
    record_audit(db, action="member.add", resource_type="user", resource_id=user.id,
                 principal=principal, metadata={"role": body.role.value,
                                                "new_account": temporary is not None})
    db.commit()
    return CreateMemberOut(member=_members(db, principal.tenant_id, user.id)[0],
                           temporary_password=temporary)


@router.patch("/users/{user_id}/roles", response_model=MemberOut)
def change_role(
    user_id: uuid.UUID,
    body: RoleIn,
    principal: Principal = Depends(require(Permission.USER_MANAGE)),
    db: Session = Depends(get_db),
) -> MemberOut:
    membership = _membership(db, principal, user_id)
    previous = membership.role
    if (previous == Role.ORG_ADMIN and body.role != Role.ORG_ADMIN
            and _admin_count(db, principal.tenant_id) <= 1):
        raise ConflictError(code="LAST_ADMIN",
                            message="The workspace must keep at least one org admin.")
    membership.role = body.role
    record_audit(db, action="member.role_change", resource_type="user", resource_id=user_id,
                 principal=principal, metadata={"from": previous.value, "to": body.role.value})
    db.commit()
    return _members(db, principal.tenant_id, user_id)[0]


@router.delete("/users/{user_id}", status_code=204)
def remove_member(
    user_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.USER_MANAGE)),
    db: Session = Depends(get_db),
) -> Response:
    membership = _membership(db, principal, user_id)
    if membership.role == Role.ORG_ADMIN and _admin_count(db, principal.tenant_id) <= 1:
        raise ConflictError(code="LAST_ADMIN",
                            message="The workspace must keep at least one org admin.")
    db.delete(membership)
    db.execute(delete(CollectionPermission).where(
        CollectionPermission.tenant_id == principal.tenant_id,
        CollectionPermission.principal_id == user_id))
    db.execute(delete(AuthSession).where(AuthSession.tenant_id == principal.tenant_id,
                                         AuthSession.user_id == user_id))
    record_audit(db, action="member.remove", resource_type="user", resource_id=user_id,
                 principal=principal)
    db.commit()
    return Response(status_code=204)


@router.get("/audit-events", response_model=AuditPage)
def audit_events(
    action: str | None = Query(default=None, max_length=64),
    resource_type: str | None = Query(default=None, max_length=64),
    outcome: str | None = Query(default=None, max_length=16),
    actor_user_id: uuid.UUID | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    cursor: str | None = None,
    principal: Principal = Depends(require(Permission.AUDIT_READ)),
    db: Session = Depends(get_db),
) -> AuditPage:
    stmt = (select(AuditEvent, User.email)
            .outerjoin(User, User.id == AuditEvent.actor_user_id)
            .where(AuditEvent.tenant_id == principal.tenant_id))
    if action:
        stmt = stmt.where(AuditEvent.action.startswith(action, autoescape=True))
    if resource_type:
        stmt = stmt.where(AuditEvent.resource_type == resource_type)
    if outcome:
        stmt = stmt.where(AuditEvent.outcome == outcome)
    if actor_user_id:
        stmt = stmt.where(AuditEvent.actor_user_id == actor_user_id)
    if cursor:
        ts, last_id = decode_cursor(cursor)
        stmt = stmt.where(or_(AuditEvent.created_at < ts,
                              (AuditEvent.created_at == ts) & (AuditEvent.id < last_id)))
    rows = db.execute(stmt.order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
                      .limit(limit + 1)).all()
    page = rows[:limit]
    return AuditPage(
        items=[AuditOut(id=e.id, created_at=e.created_at, actor_user_id=e.actor_user_id,
                        actor_email=email, action=e.action, resource_type=e.resource_type,
                        resource_id=e.resource_id, outcome=e.outcome,
                        correlation_id=e.correlation_id, metadata=dict(e.safe_metadata or {}))
               for e, email in page],
        next_cursor=encode_cursor(page[-1][0].created_at, page[-1][0].id)
        if len(rows) > limit else None,
    )
