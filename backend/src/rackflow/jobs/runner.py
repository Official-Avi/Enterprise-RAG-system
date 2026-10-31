"""Runs one claimed job: builds the JobContext, invokes the handler, records the outcome.

Outcome writes use a fresh session (the handler's session may be mid-failure), and are guarded
by lease ownership. Unknown exceptions are reported with a generic safe message — `str(exc)` can
contain document text and is never stored or shown. Import / native library load failures are
not retried: they fail the same way on every attempt (DEPENDENCY_UNAVAILABLE).
"""

from __future__ import annotations

import logging
import time

from rackflow.core.logging import correlation_id_var, new_correlation_id
from rackflow.db.models import JobStatus
from rackflow.db.session import get_sessionmaker
from rackflow.jobs import queue
from rackflow.jobs.context import JobContext
from rackflow.jobs.errors import (
    DEPENDENCY_MESSAGE,
    DEPENDENCY_UNAVAILABLE,
    JobCancelled,
    JobError,
    dependency_name,
    is_dependency_failure,
)
from rackflow.jobs.registry import get_handler

log = logging.getLogger("rackflow.jobs")


class LeaseLost(Exception):
    """This worker no longer owns the job (lease expired and another worker reclaimed it)."""


def _log_dependency_failure(claim: queue.ClaimedJob, exc: BaseException) -> None:
    """Operator-facing detail for DEPENDENCY_UNAVAILABLE: the module name and the loader error
    type/code, never the exception text (it can contain local paths)."""
    root = exc
    for _ in range(20):  # bounded: exception chains can, in theory, be cyclic
        parent = root.__cause__ or root.__context__
        if parent is None:
            break
        root = parent
    log.error("job_dependency_unavailable", extra={
        "job_id": str(claim.job_id), "job_type": claim.job_type.value,
        "dependency": dependency_name(exc), "exc_type": type(root).__name__,
        "winerror": getattr(root, "winerror", None),
    })


def run_claimed_job(claim: queue.ClaimedJob, worker_id: str, *, lease_seconds: int) -> str:
    sessions = get_sessionmaker()
    token = correlation_id_var.set(claim.correlation_id or new_correlation_id())
    last_renewal = time.monotonic()

    def heartbeat() -> None:
        nonlocal last_renewal
        if time.monotonic() - last_renewal < lease_seconds / 4:
            return
        with sessions() as s:
            if not queue.renew_lease(s, claim, worker_id, lease_seconds):
                raise LeaseLost()
        last_renewal = time.monotonic()

    log.info("job_started", extra={"job_id": str(claim.job_id), "job_type": claim.job_type.value,
                                   "attempt": claim.attempt_number, "worker_id": worker_id})
    started = time.perf_counter()
    outcome: str
    try:
        with sessions() as db:
            ctx = JobContext(
                db=db, job_id=claim.job_id, tenant_id=claim.tenant_id,
                document_id=claim.document_id, attempt_number=claim.attempt_number,
                worker_id=worker_id, correlation_id=correlation_id_var.get() or "",
                payload=claim.payload, heartbeat=heartbeat,
            )
            try:
                get_handler(claim.job_type)(ctx)
                db.commit()
            except BaseException:
                db.rollback()
                raise
        with sessions() as s:
            outcome = "succeeded" if queue.mark_succeeded(s, claim, worker_id) else "lease_lost"
    except LeaseLost:
        outcome = "lease_lost"
    except JobCancelled:
        with sessions() as s:
            outcome = "cancelled" if queue.mark_cancelled(s, claim, worker_id) else "lease_lost"
    except JobError as exc:
        if exc.code == DEPENDENCY_UNAVAILABLE:
            _log_dependency_failure(claim, exc)
        with sessions() as s:
            status = queue.mark_failed(s, claim, worker_id, code=exc.code,
                                       message=exc.safe_message, retryable=exc.retryable)
        outcome = status.value if status else "lease_lost"
    except Exception as exc:  # noqa: BLE001 — unknown errors are transient, except loader errors
        if is_dependency_failure(exc):
            # An import / native library failure is deterministic on this host: fail it once.
            _log_dependency_failure(claim, exc)
            code, message, retryable = DEPENDENCY_UNAVAILABLE, DEPENDENCY_MESSAGE, False
        else:
            log.error("job_unexpected_error", extra={"job_id": str(claim.job_id),
                                                     "exc_type": type(exc).__name__})
            code, message = "INTERNAL_ERROR", "An unexpected processing error occurred."
            retryable = True
        with sessions() as s:
            status = queue.mark_failed(s, claim, worker_id, code=code, message=message,
                                       retryable=retryable)
        outcome = status.value if status else "lease_lost"
    finally:
        correlation_id_var.reset(token)

    log.info("job_finished", extra={
        "job_id": str(claim.job_id), "outcome": outcome, "attempt": claim.attempt_number,
        "duration_ms": int((time.perf_counter() - started) * 1000), "worker_id": worker_id,
    })
    return outcome


__all__ = ["JobStatus", "LeaseLost", "run_claimed_job"]
