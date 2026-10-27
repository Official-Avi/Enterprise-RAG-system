"""Admin CLI.

    rackflow-admin create-user --email a@b.com --name "A" --tenant acme --role org_admin
    rackflow-admin seed-demo            # two demo tenants with one user per role

Passwords are read from RACKFLOW_SEED_PASSWORD / --password-env, or generated and printed once.
They are never hard-coded or written to logs.
"""

from __future__ import annotations

import argparse
import os
import re
import secrets
import sys

from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.auth.passwords import hash_password
from rackflow.db.models import Role, Tenant, TenantMembership, User
from rackflow.db.session import session_scope

DEMO_USERS = [
    ("acme", "Acme Corp", "admin@acme.example.com", "Acme Admin", Role.ORG_ADMIN),
    ("acme", "Acme Corp", "operator@acme.example.com", "Acme Operator", Role.OPERATOR),
    ("acme", "Acme Corp", "engineer@acme.example.com", "Acme Engineer", Role.ENGINEER),
    ("acme", "Acme Corp", "auditor@acme.example.com", "Acme Auditor", Role.AUDITOR),
    ("globex", "Globex Inc", "admin@globex.example.com", "Globex Admin", Role.ORG_ADMIN),
    ("globex", "Globex Inc", "engineer@globex.example.com", "Globex Engineer", Role.ENGINEER),
]


def ensure_tenant(db: Session, slug: str, name: str) -> Tenant:
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,78}", slug):
        raise ValueError("tenant slug must be lowercase letters, digits and dashes")
    tenant = db.scalar(select(Tenant).where(Tenant.slug == slug))
    if tenant is None:
        tenant = Tenant(slug=slug, name=name)
        db.add(tenant)
        db.flush()
    return tenant


def ensure_user(
    db: Session, *, email: str, name: str, password: str, tenant: Tenant, role: Role
) -> tuple[User, bool]:
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    created = user is None
    if user is None:
        user = User(email=email, display_name=name, password_hash=hash_password(password))
        db.add(user)
        db.flush()
    membership = db.scalar(
        select(TenantMembership).where(
            TenantMembership.tenant_id == tenant.id, TenantMembership.user_id == user.id
        )
    )
    if membership is None:
        db.add(TenantMembership(tenant_id=tenant.id, user_id=user.id, role=role))
    else:
        membership.role = role
    db.flush()
    return user, created


def _password(env_name: str) -> tuple[str, bool]:
    value = os.environ.get(env_name)
    if value:
        return value, False
    return secrets.token_urlsafe(16), True


def cmd_seed_demo(args: argparse.Namespace) -> int:
    password, generated = _password(args.password_env)
    with session_scope() as db:
        for slug, tname, email, name, role in DEMO_USERS:
            tenant = ensure_tenant(db, slug, tname)
            _, created = ensure_user(db, email=email, name=name, password=password,
                                     tenant=tenant, role=role)
            print(f"{'created' if created else 'exists '}  {email:32s} {slug:8s} {role.value}")
    if generated:
        print(f"\nGenerated demo password (shown once, store it safely): {password}")
    else:
        print(f"\nDemo users use the password from ${args.password_env}.")
    return 0


def cmd_create_user(args: argparse.Namespace) -> int:
    password, generated = _password(args.password_env)
    with session_scope() as db:
        tenant = ensure_tenant(db, args.tenant, args.tenant_name or args.tenant)
        _, created = ensure_user(db, email=args.email, name=args.name, password=password,
                                 tenant=tenant, role=Role(args.role))
    print(("Created" if created else "Updated membership for") + f" {args.email}")
    if generated and created:
        print(f"Generated password (shown once): {password}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rackflow-admin")
    sub = parser.add_subparsers(dest="command", required=True)

    seed = sub.add_parser("seed-demo", help="create demo tenants and one user per role")
    seed.add_argument("--password-env", default="RACKFLOW_SEED_PASSWORD")
    seed.set_defaults(func=cmd_seed_demo)

    cu = sub.add_parser("create-user", help="create a user and tenant membership")
    cu.add_argument("--email", required=True)
    cu.add_argument("--name", required=True)
    cu.add_argument("--tenant", required=True, help="tenant slug")
    cu.add_argument("--tenant-name")
    cu.add_argument("--role", required=True, choices=[r.value for r in Role])
    cu.add_argument("--password-env", default="RACKFLOW_NEW_USER_PASSWORD")
    cu.set_defaults(func=cmd_create_user)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
