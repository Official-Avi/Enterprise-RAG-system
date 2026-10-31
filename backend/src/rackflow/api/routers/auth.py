from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.audit import record_audit
from rackflow.auth.demo import DEMO_PERSONAS, find_persona
from rackflow.auth.deps import get_principal
from rackflow.auth.passwords import verify_password
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import ROLE_PERMISSIONS
from rackflow.auth.sessions import SESSION_COOKIE, create_session, revoke_session
from rackflow.core.config import get_settings
from rackflow.core.errors import NotFoundError, UnauthenticatedError
from rackflow.core.ratelimit import demo_login_limiter, login_limiter
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


class DemoPersonaOut(BaseModel):
    key: str
    title: str
    display_name: str
    email: str
    summary: str
    can: list[str]
    cannot: list[str]


class DemoInfoOut(BaseModel):
    enabled: bool
    personas: list[DemoPersonaOut]


class DemoLoginRequest(BaseModel):
    persona: str = Field(min_length=1, max_length=40)


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

    return _start_session(db, response, user, chosen, mode=body.mode, action="auth.login")


def _start_session(
    db: Session, response: Response, user: User, membership: MembershipOut, *,
    mode: Literal["cookie", "token"], action: str,
) -> LoginOut:
    token, session = create_session(db, user_id=user.id, tenant_id=membership.tenant_id)
    record_audit(db, action=action, resource_type="user", resource_id=user.id,
                 tenant_id=membership.tenant_id, actor_user_id=user.id)
    db.commit()

    if mode == "cookie":
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
    principal = Principal(user_id=user.id, tenant_id=membership.tenant_id,
                          role=Role(membership.role), session_id=session.id, email=user.email,
                          display_name=user.display_name)
    out = LoginOut(**_me(db, principal).model_dump())
    out.token = token if mode == "token" else None
    return out


def _demo_account(db: Session, key: str) -> tuple[User, MembershipOut] | None:
    """The seeded, active account behind a persona, or None if it is not available."""
    persona = find_persona(key)
    if persona is None:
        return None
    user = db.scalar(select(User).where(User.email == persona.email))
    if user is None or user.status != "active":
        return None
    membership = next(
        (m for m in _memberships(db, user.id) if m.tenant_slug == persona.tenant_slug), None
    )
    return (user, membership) if membership else None


@router.get("/demo", response_model=DemoInfoOut)
def demo_info(db: Session = Depends(get_db)) -> DemoInfoOut:
    """Public: which one-click demo personas exist. Empty unless DEMO_MODE is on."""
    if not get_settings().demo_mode:
        return DemoInfoOut(enabled=False, personas=[])
    personas = []
    for p in DEMO_PERSONAS:
        account = _demo_account(db, p.key)
        if account is None:
            continue
        personas.append(DemoPersonaOut(
            key=p.key, title=p.title, display_name=account[0].display_name, email=p.email,
            summary=p.summary, can=list(p.can), cannot=list(p.cannot),
        ))
    return DemoInfoOut(enabled=True, personas=personas)


@router.post("/demo", response_model=LoginOut)
def demo_login(
    body: DemoLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)
) -> LoginOut:
    """Public: sign in as a demo persona without a password (DEMO_MODE only)."""
    if not get_settings().demo_mode:
        raise NotFoundError()
    client = request.client.host if request.client else "unknown"
    demo_login_limiter.hit(client)
    account = _demo_account(db, body.persona)
    if account is None:
        raise NotFoundError(code="DEMO_PERSONA_NOT_FOUND",
                            message="That demo account is not available.")
    user, membership = account
    return _start_session(db, response, user, membership, mode="cookie",
                          action="auth.demo_login")


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
