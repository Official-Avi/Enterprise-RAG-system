from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.audit import record_audit
from rackflow.auth.deps import get_principal
from rackflow.auth.passwords import verify_password
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import ROLE_PERMISSIONS
from rackflow.auth.sessions import SESSION_COOKIE, create_session, revoke_session
from rackflow.core.config import get_settings
from rackflow.core.errors import UnauthenticatedError
from rackflow.core.ratelimit import login_limiter
from rackflow.db.models import Role, Tenant, TenantMembership, User
from rackflow.db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=512)
    tenant_slug: str | None = Field(default=None, max_length=80)
    mode: Literal["cookie", "token"] = "cookie"


class MembershipOut(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    tenant_slug: str
    role: str


class MeOut(BaseModel):
    user_id: uuid.UUID
    email: str
    display_name: str
    tenant_id: uuid.UUID
    role: str
    permissions: list[str]
    memberships: list[MembershipOut]


class LoginOut(MeOut):
    token: str | None = None  # only for mode="token" (API clients)


def _memberships(db: Session, user_id: uuid.UUID) -> list[MembershipOut]:
    rows = db.execute(
        select(TenantMembership, Tenant)
        .join(Tenant, Tenant.id == TenantMembership.tenant_id)
        .where(TenantMembership.user_id == user_id, Tenant.status == "active")
        .order_by(Tenant.name)
    ).all()
    return [
        MembershipOut(tenant_id=t.id, tenant_name=t.name, tenant_slug=t.slug, role=m.role.value)
        for m, t in rows
    ]


def _me(db: Session, principal: Principal) -> MeOut:
    return MeOut(
        user_id=principal.user_id,
        email=principal.email,
        display_name=principal.display_name,
        tenant_id=principal.tenant_id,
        role=principal.role.value,
        permissions=sorted(p.value for p in ROLE_PERMISSIONS[principal.role]),
        memberships=_memberships(db, principal.user_id),
    )


@router.post("/login", response_model=LoginOut)
def login(
    body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> LoginOut:
    client = request.client.host if request.client else "unknown"
    login_limiter.hit(f"{client}:{body.email.lower()}")

    user = db.scalar(select(User).where(User.email == body.email.lower()))
    password_ok = verify_password(body.password, user.password_hash if user else None)
    if user is None or not password_ok or user.status != "active":
        record_audit(db, action="auth.login", resource_type="user", outcome="denied",
                     tenant_id=None, metadata={"reason": "invalid_credentials"})
        db.commit()
        raise UnauthenticatedError(code="INVALID_CREDENTIALS",
                                   message="Email or password is incorrect.")

    memberships = _memberships(db, user.id)
    chosen = next(
        (m for m in memberships if body.tenant_slug is None or m.tenant_slug == body.tenant_slug),
        None,
    )
    if chosen is None:
        raise UnauthenticatedError(code="INVALID_CREDENTIALS",
                                   message="Email or password is incorrect.")

    token, session = create_session(db, user_id=user.id, tenant_id=chosen.tenant_id)
    record_audit(db, action="auth.login", resource_type="user", resource_id=user.id,
                 tenant_id=chosen.tenant_id, actor_user_id=user.id)
    db.commit()

    if body.mode == "cookie":
        settings = get_settings()
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=settings.session_ttl_hours * 3600,
            httponly=True,
            secure=settings.cookie_secure,
            samesite="lax",
            path="/",
        )
    principal = Principal(user_id=user.id, tenant_id=chosen.tenant_id, role=Role(chosen.role),
                          session_id=session.id, email=user.email, display_name=user.display_name)
    out = LoginOut(**_me(db, principal).model_dump())
    out.token = token if body.mode == "token" else None
    return out


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
) -> Response:
    if principal.session_id:
        revoke_session(db, principal.session_id)
    record_audit(db, action="auth.logout", resource_type="user", resource_id=principal.user_id,
                 principal=principal)
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.status_code = 204
    return response


@router.get("/me", response_model=MeOut)
def me(principal: Principal = Depends(get_principal), db: Session = Depends(get_db)) -> MeOut:
    return _me(db, principal)
