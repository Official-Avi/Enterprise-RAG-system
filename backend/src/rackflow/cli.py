"""Admin CLI.

    rackflow-admin create-user --email a@b.com --name "A" --tenant acme --role org_admin
    rackflow-admin seed-demo            # two demo tenants with one user per role
    rackflow-admin reindex --tenant acme [--include-failed] [--dry-run]

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


GIB = 1024**3
SIM = {"simulated": True, "note": "Demo inventory - not real hardware"}


def cmd_seed_infra(args: argparse.Namespace) -> int:
    """Seed clearly labelled SIMULATED racks, nodes and workloads for demos."""
    from rackflow.db.models import NodeResource, Rack, StateSource, Workload

    sim = StateSource.SIMULATED
    with session_scope() as db:
        tenant = db.scalar(select(Tenant).where(Tenant.slug == args.tenant))
        if tenant is None:
            print(f"tenant {args.tenant!r} not found")
            return 1
        existing = select(Rack.id).where(Rack.tenant_id == tenant.id, Rack.name == "sim-rack-a1")
        if db.scalar(existing):
            print("simulated inventory already present")
            return 0
        racks = {
            "sim-rack-a1": Rack(tenant_id=tenant.id, name="sim-rack-a1", environment="production",
                                location_label="DC-1 / Row A", rack_units=42, state_source=sim,
                                status="healthy", description="Simulated production rack",
                                metadata_json=SIM),
            "sim-rack-b2": Rack(tenant_id=tenant.id, name="sim-rack-b2", environment="staging",
                                location_label="DC-1 / Row B", rack_units=24, state_source=sim,
                                status="degraded", description="Simulated staging rack",
                                metadata_json=SIM),
        }
        db.add_all(racks.values())
        db.flush()
        spec = [  # name, rack, type, U, cpu, mem GiB, accel, storage GiB, status
            ("sim-api-01", "sim-rack-a1", "server", 38, 16, 64, None, 500, "healthy"),
            ("sim-worker-01", "sim-rack-a1", "server", 36, 32, 128, None, 1000, "healthy"),
            ("sim-worker-02", "sim-rack-a1", "server", 34, 32, 128, None, 1000, "healthy"),
            ("sim-gpu-01", "sim-rack-a1", "gpu_node", 30, 48, 256, "2x NVIDIA L4 24GB", 2000,
             "healthy"),
            ("sim-storage-01", "sim-rack-a1", "storage", 26, 16, 64, None, 20000, "healthy"),
            ("sim-stage-01", "sim-rack-b2", "server", 20, 8, 32, None, 500, "degraded"),
        ]
        nodes: dict[str, NodeResource] = {}
        for name, rack, rtype, unit, cpu, mem, accel, disk, status in spec:
            nodes[name] = NodeResource(
                tenant_id=tenant.id, rack_id=racks[rack].id, name=name, resource_type=rtype,
                rack_unit_position=unit, cpu_cores=cpu, memory_bytes=mem * GIB,
                accelerator_info=accel, storage_bytes=disk * GIB, state_source=sim,
                status=status, metadata_json=SIM)
        db.add_all(nodes.values())
        db.flush()
        workloads = [  # name, type, node, cpu, mem GiB, accel, observed
            ("rackflow-api", "api", "sim-api-01", 4, 8, 0, "running"),
            ("rackflow-worker-1", "worker", "sim-worker-01", 8, 16, 0, "running"),
            ("rackflow-worker-2", "worker", "sim-worker-02", 8, 16, 0, "running"),
            ("qdrant", "vector_db", "sim-storage-01", 4, 32, 0, "running"),
            ("postgresql", "database", "sim-storage-01", 8, 24, 0, "running"),
            ("model-serving-qwen2.5", "model_serving", "sim-gpu-01", 16, 64, 1, "running"),
            ("rackflow-staging", "api", "sim-stage-01", 4, 8, 0, "degraded"),
        ]
        for w_name, wtype, node, w_cpu, w_mem, w_accel, observed in workloads:
            db.add(Workload(
                tenant_id=tenant.id, name=w_name, workload_type=wtype, node_id=nodes[node].id,
                desired_state="running", observed_state=observed,
                resource_request={"cpu_cores": w_cpu, "memory_bytes": w_mem * GIB,
                                  **({"accelerators": w_accel} if w_accel else {})},
                resource_assignment={}, state_source=sim))
    print(f"seeded simulated inventory for {args.tenant}: 2 racks, {len(spec)} nodes, "
          f"{len(workloads)} workloads (all labelled simulated)")
    return 0


def cmd_seed_eval(args: argparse.Namespace) -> int:
    from rackflow.evaluation.dataset import load_dataset
    from rackflow.evaluation.seed import seed_dataset

    with session_scope() as db:
        row = db.execute(
            select(Tenant.id, User.id)
            .join(TenantMembership, TenantMembership.tenant_id == Tenant.id)
            .join(User, User.id == TenantMembership.user_id)
            .where(Tenant.slug == args.tenant, User.email == args.owner_email.lower())
        ).first()
        if row is None:
            print("tenant or member not found")
            return 1
        result = seed_dataset(db, load_dataset(args.version), tenant_id=row[0], user_id=row[1])
    print(f"main collection {result.main_collection_id}, restricted collection "
          f"{result.restricted_collection_id}: {result.queued} queued, {result.duplicates} "
          f"already present, rejected={result.rejected}. Run a worker to index them.")
    return 0


REINDEX_PRIORITY = 200  # behind interactive uploads (100), so a bulk re-index never blocks them


def cmd_reindex(args: argparse.Namespace) -> int:
    """Re-queue ingestion for a tenant's documents so their vectors are rebuilt from the stored
    originals (recovery after the vector collection was lost, or an embedding model change).

    Each document gets a fresh ingest job and DocumentVersion; the worker re-runs every stage,
    re-embeds and upserts, then FINALIZE drops the old version's chunks and vectors. Documents
    are moved to `queued`, so running the command again does not queue them twice."""
    from rackflow.audit import record_audit
    from rackflow.db.models import Document, DocumentStatus, JobType
    from rackflow.ingestion.service import next_ingest_version
    from rackflow.jobs.enqueue import enqueue_job

    statuses = [DocumentStatus.INDEXED] + ([DocumentStatus.FAILED] if args.include_failed else [])
    with session_scope() as db:
        tenant = db.scalar(select(Tenant).where(Tenant.slug == args.tenant))
        if tenant is None:
            print(f"tenant {args.tenant!r} not found")
            return 1
        docs = db.scalars(
            select(Document)
            .where(Document.tenant_id == tenant.id, Document.status.in_(statuses),
                   Document.deleted_at.is_(None))
            .order_by(Document.created_at)
        ).all()
        verb = "would queue" if args.dry_run else "queued"
        counts = {s.value: 0 for s in statuses}
        for doc in docs:
            counts[doc.status.value] += 1
            version = next_ingest_version(db, doc.id)
            print(f"{verb:11s} {doc.id}  v{version}  {doc.status.value:8s} {doc.filename}")
            if args.dry_run:
                continue
            enqueue_job(db, tenant_id=tenant.id, job_type=JobType.INGEST_DOCUMENT,
                        idempotency_key=f"reindex:{doc.id}:{version}", document_id=doc.id,
                        collection_id=doc.collection_id,
                        payload={"document_id": str(doc.id), "version": version},
                        priority=REINDEX_PRIORITY)
            doc.status = DocumentStatus.QUEUED
            record_audit(db, action="document.reindex", resource_type="document",
                         resource_id=doc.id, tenant_id=tenant.id,
                         metadata={"version": version, "source": "cli"})
        if args.dry_run:
            db.rollback()
    found = ", ".join(f"{n} {status}" for status, n in counts.items())
    print(f"\n{args.tenant}: {found} -> {verb} {len(docs)} document(s)."
          + (" Dry run: nothing was changed." if args.dry_run
             else " Run a worker to re-index them."))
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

    se = sub.add_parser("seed-eval", help="create evaluation collections and queue the corpus")
    se.add_argument("--tenant", required=True, help="tenant slug")
    se.add_argument("--owner-email", required=True, help="member who owns the main collection")
    se.add_argument("--version", default="v1")
    se.set_defaults(func=cmd_seed_eval)

    si = sub.add_parser("seed-infra", help="seed SIMULATED racks/nodes/workloads for a tenant")
    si.add_argument("--tenant", required=True, help="tenant slug")
    si.set_defaults(func=cmd_seed_infra)

    ri = sub.add_parser("reindex", help="re-queue ingestion to rebuild a tenant's vectors")
    ri.add_argument("--tenant", required=True, help="tenant slug")
    ri.add_argument("--include-failed", action="store_true",
                    help="also re-queue documents whose ingestion failed")
    ri.add_argument("--dry-run", action="store_true", help="list the documents, change nothing")
    ri.set_defaults(func=cmd_reindex)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
