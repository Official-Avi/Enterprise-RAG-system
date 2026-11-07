"""EVALUATION_RUN job handler: answers every dataset question through the real RAG path with the
permissions of the user who started the run, then stores per-question scores and aggregates.

A run sends questions as fast as the model answers, so a rate-limited model (a free plan allows a
few thousand tokens a minute) refuses most of them unless the run waits. A busy model is retried
with bounded backoff that reaches past a one-minute window; the run stays responsive to cancel and
keeps its lease while it waits."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select

from rackflow.auth.access import accessible_collections
from rackflow.auth.principal import Principal
from rackflow.core.errors import AppError
from rackflow.db.models import Collection, EvaluationRun, TenantMembership, User
from rackflow.evaluation.dataset import load_dataset
from rackflow.evaluation.metrics import aggregate, score_question
from rackflow.jobs.context import JobContext
from rackflow.jobs.errors import PermanentJobError
from rackflow.rag.answer import AnswerResult, answer_question

log = logging.getLogger(__name__)

MODEL_BUSY = "MODEL_OVERLOADED"
# Waits before each further try of one question. The last ones outlast a one-minute token window.
BUSY_BACKOFF_SECONDS = (5.0, 15.0, 30.0, 65.0, 65.0)
# A provider asking for longer than this has run out of more than its per-minute allowance.
MAX_RETRY_AFTER_SECONDS = 120.0
WAIT_TICK_SECONDS = 5.0  # well inside the shortest lease, and how soon a cancel is noticed


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _wait(ctx: JobContext, seconds: float) -> None:
    """Wait without losing the lease or ignoring a cancel, and with no transaction left open."""
    remaining = seconds
    while remaining > 0:
        tick = min(remaining, WAIT_TICK_SECONDS)
        _sleep(tick)
        remaining -= tick
        ctx.check_cancelled()
        ctx.heartbeat()
        ctx.db.rollback()


def _busy_wait(exc: AppError, schedule: Iterator[float]) -> float | None:
    """Seconds to wait before trying again, or None when this error should stand."""
    if exc.code != MODEL_BUSY:
        return None
    scheduled = next(schedule, None)
    if scheduled is None:
        return None
    retry_after = getattr(exc, "retry_after", None)
    if retry_after is None:
        return scheduled
    return float(retry_after) + 1.0 if retry_after <= MAX_RETRY_AFTER_SECONDS else None


def _answer(ctx: JobContext, principal: Principal, question: str,
            collection_ids: list[uuid.UUID], *, patient: bool) -> AnswerResult:
    schedule = iter(BUSY_BACKOFF_SECONDS if patient else ())
    while True:
        try:
            return answer_question(ctx.db, principal, question, collection_ids)
        except AppError as exc:
            ctx.db.rollback()
            wait = _busy_wait(exc, schedule)
            if wait is None:
                raise
            log.info("evaluation_model_busy", extra={"job_id": str(ctx.job_id),
                                                     "wait_seconds": wait})
        _wait(ctx, wait)


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


def run_status(results: list[dict[str, Any]]) -> str:
    """A run where any question errored must not read as a clean pass (BUG-10): the job did
    finish, but its figures leave those questions out, so they are not safe to headline."""
    return "completed_with_errors" if any("error" in r for r in results) else "completed"


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
    # A question that used up its waits means an outage, not a passing limit: later questions get
    # one try each until the model answers again, so a dead model does not hold the run for an hour.
    patient = True
    for q in dataset.questions:
        ctx.check_cancelled()
        ctx.heartbeat()
        try:
            ans = _answer(ctx, principal, q.question, collection_ids, patient=patient)
        except AppError as exc:
            db.rollback()
            patient = patient and exc.code != MODEL_BUSY
            results.append({"id": q.id, "category": q.category, "error": exc.code})
            continue
        patient = True
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
    run.status = run_status(results)
    run.finished_at = datetime.now(UTC)
    db.commit()
    log.info("evaluation_completed", extra={"run_id": str(run.id), "questions": len(results)})
