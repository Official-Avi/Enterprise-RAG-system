"""EVALUATION_RUN job handler: answers every dataset question through the real RAG path with the
permissions of the user who started the run, then stores per-question scores and aggregates."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime

from sqlalchemy import select

from rackflow.auth.access import accessible_collections
from rackflow.auth.principal import Principal
from rackflow.core.errors import AppError
from rackflow.db.models import Collection, EvaluationRun, TenantMembership, User
from rackflow.evaluation.dataset import load_dataset
from rackflow.evaluation.metrics import aggregate, score_question
from rackflow.jobs.context import JobContext
from rackflow.jobs.errors import PermanentJobError
from rackflow.rag.answer import answer_question

log = logging.getLogger(__name__)


def _principal(ctx: JobContext, user_id: uuid.UUID | None) -> Principal:
    row = ctx.db.execute(
        select(User, TenantMembership)
        .join(TenantMembership, TenantMembership.user_id == User.id)
        .where(User.id == user_id, TenantMembership.tenant_id == ctx.tenant_id,
               User.status == "active")
    ).first() if user_id else None
    if row is None:
        raise PermanentJobError("RUN_OWNER_GONE",
                                "The user who started this run no longer has access.")
    user, membership = row
    return Principal(user_id=user.id, tenant_id=ctx.tenant_id, role=membership.role,
                     session_id=None, email=user.email, display_name=user.display_name)


def run_evaluation(ctx: JobContext) -> None:
    db = ctx.db
    run = db.get(EvaluationRun, uuid.UUID(str(ctx.payload["run_id"])))
    if run is None or run.tenant_id != ctx.tenant_id:
        raise PermanentJobError("RUN_NOT_FOUND", "The evaluation run no longer exists.")
    try:
        dataset = load_dataset(run.dataset_version)
    except KeyError as exc:
        raise PermanentJobError("DATASET_NOT_FOUND", "Unknown dataset version.") from exc
    principal = _principal(ctx, run.created_by)
    collection_ids = [uuid.UUID(c) for c in run.model_config.get("collection_ids", [])]
    accessible = accessible_collections(db, principal)
    restricted_ids = set(db.scalars(select(Collection.id).where(
        Collection.tenant_id == ctx.tenant_id,
        Collection.name == f"Evaluation restricted ({dataset.version})")).all())
    restricted_accessible = bool(restricted_ids & set(accessible))

    run.status = "running"
    run.started_at = datetime.now(UTC)
    db.commit()

    results = []
    for q in dataset.questions:
        ctx.check_cancelled()
        ctx.heartbeat()
        try:
            ans = answer_question(db, principal, q.question, collection_ids)
        except AppError as exc:
            db.rollback()
            results.append({"id": q.id, "category": q.category, "error": exc.code})
            continue
        scored = score_question(
            q, retrieved_docs=[s.filename for s in ans.sources],
            cited_docs=[c.chunk.filename for c in ans.citations], answer=ans.answer,
            evidence_status=ans.evidence_status, latency_ms=ans.latency_ms,
            restricted_accessible=restricted_accessible)
        scored.update({"question": q.question, "answer": ans.answer})
        results.append(scored)

    refreshed = db.get(EvaluationRun, run.id)
    if refreshed is None:
        raise PermanentJobError("RUN_NOT_FOUND", "The evaluation run no longer exists.")
    run = refreshed
    run.results = results
    run.metrics = aggregate(results)
    run.status = "completed"
    run.finished_at = datetime.now(UTC)
    db.commit()
    log.info("evaluation_completed", extra={"run_id": str(run.id), "questions": len(results)})
