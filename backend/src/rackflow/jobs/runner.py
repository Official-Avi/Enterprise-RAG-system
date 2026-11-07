"""Runs one claimed job: builds the JobContext, invokes the handler, records the outcome.

Outcome writes use a fresh session (the handler's session may be mid-failure), and are guarded
by lease ownership. Unknown exceptions are reported with a generic safe message — `str(exc)` can
contain document text and is never stored or shown. Import / native library load failures are
not retried: they fail the same way on every attempt (DEPENDENCY_UNAVAILABLE).

A database outage must not lose the result or kill the worker: outcome writes are retried for up
to one lease. If the database is still down after that the job stays leased, the lease expires,
and any worker reclaims it once the database is back (outcome `db_unavailable`).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

from sqlalchemy.orm import Session

from rackflow.core.logging import correlation_id_var, new_correlation_id
from rackflow.db.models import JobStatus
from rackflow.db.session import get_sessionmaker
from rackflow.jobs import queue
from rackflow.jobs.context import JobContext
from rackflow.jobs.errors import (
    DATABASE_MESSAGE,
    DATABASE_UNAVAILABLE,
    DEPENDENCY_MESSAGE,
    DEPENDENCY_UNAVAILABLE,
    JobCancelled,
    JobError,
    dependency_name,
    is_database_outage,
    is_dependency_failure,
)
from rackflow.jobs.registry import get_handler

log = logging.getLogger("rackflow.jobs")
OUTCOME_RETRY_MAX_DELAY_SECONDS = 15.0
DB_UNAVAILABLE = "db_unavailable"


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


def _mark_failed(s: Session, claim: queue.ClaimedJob, worker_id: str, code: str, message: str,
                 retryable: bool) -> str:
    status = queue.mark_failed(s, claim, worker_id, code=code, message=message,
                               retryable=retryable)
    return status.value if status else "lease_lost"


def _record_outcome(claim: queue.ClaimedJob, lease_seconds: int,
                    write: Callable[[Session], str]) -> str:
    """Write a job outcome, waiting out a database outage for up to one lease."""
    sessions = get_sessionmaker()
    deadline = time.monotonic() + lease_seconds
    delay = 1.0
    while True:
        try:
            with sessions() as s:
                return write(s)
        except Exception as exc:  # noqa: BLE001 — anything but an outage is re-raised
            if not is_database_outage(exc):
                raise
            log.warning("job_outcome_write_failed", extra={"job_id": str(claim.job_id),
                                                            "exc_type": type(exc).__name__})
        if time.monotonic() >= deadline:
            return DB_UNAVAILABLE
        time.sleep(delay)
        delay = min(delay * 2, OUTCOME_RETRY_MAX_DELAY_SECONDS)


def run_claimed_job(claim: queue.ClaimedJob, worker_id: str, *, lease_seconds: int) -> str:
    sessions = get_sessionmaker()
    token = correlation_id_var.set(claim.correlation_id or new_correlation_id())
    last_renewal = time.monotonic()

    def heartbeat() -> None:
        nonlocal last_renewal
        if time.monotonic() - last_renewal < lease_seconds / 4:
            return
        try:
            with sessions() as s:
                renewed = queue.renew_lease(s, claim, worker_id, lease_seconds)
        except Exception as exc:  # noqa: BLE001 — a blip must not fail work that needs no database
            if not is_database_outage(exc):
                raise
            log.warning("job_lease_renewal_failed", extra={"job_id": str(claim.job_id),
                                                           "exc_type": type(exc).__name__})
            return
        if not renewed:
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
        outcome = _record_outcome(
            claim, lease_seconds,
            lambda s: "succeeded" if queue.mark_succeeded(s, claim, worker_id) else "lease_lost")
    except LeaseLost:
        outcome = "lease_lost"
    except JobCancelled:
        outcome = _record_outcome(
            claim, lease_seconds,
            lambda s: "cancelled" if queue.mark_cancelled(s, claim, worker_id) else "lease_lost")
    except JobError as exc:
        if exc.code == DEPENDENCY_UNAVAILABLE:
            _log_dependency_failure(claim, exc)
        job_error = exc
        outcome = _record_outcome(
            claim, lease_seconds,
            lambda s: _mark_failed(s, claim, worker_id, job_error.code, job_error.safe_message,
                                   job_error.retryable))
    except Exception as exc:  # noqa: BLE001 — unknown errors are transient, except loader errors
        if is_database_outage(exc):
            log.warning("job_database_unavailable", extra={"job_id": str(claim.job_id),
                                                           "exc_type": type(exc).__name__})
            code, message, retryable = DATABASE_UNAVAILABLE, DATABASE_MESSAGE, True
        elif is_dependency_failure(exc):
            # An import / native library failure is deterministic on this host: fail it once.
            _log_dependency_failure(claim, exc)
            code, message, retryable = DEPENDENCY_UNAVAILABLE, DEPENDENCY_MESSAGE, False
        else:
            log.error("job_unexpected_error", extra={"job_id": str(claim.job_id),
                                                     "exc_type": type(exc).__name__})
            code, message = "INTERNAL_ERROR", "An unexpected processing error occurred."
            retryable = True
        outcome = _record_outcome(
            claim, lease_seconds,
            lambda s: _mark_failed(s, claim, worker_id, code, message, retryable))
    finally:
        correlation_id_var.reset(token)

    log.info("job_finished", extra={
        "job_id": str(claim.job_id), "outcome": outcome, "attempt": claim.attempt_number,
        "duration_ms": int((time.perf_counter() - started) * 1000), "worker_id": worker_id,
    })
    return outcome


__all__ = ["DB_UNAVAILABLE", "JobStatus", "LeaseLost", "run_claimed_job"]
