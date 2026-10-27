"""Background worker process:  rackflow-worker  (or  python -m rackflow.worker.main).

Scale horizontally by starting more processes; the SKIP LOCKED queue distributes jobs safely.
"""

from __future__ import annotations

import argparse
import importlib
import logging
import os
import secrets
import signal
import socket
import sys
import threading
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.dialects.postgresql import insert

from rackflow import __version__
from rackflow.core.config import get_settings
from rackflow.core.logging import configure_logging
from rackflow.db.models import JobType, WorkerHeartbeat
from rackflow.db.session import get_sessionmaker
from rackflow.jobs import queue
from rackflow.jobs.runner import run_claimed_job

log = logging.getLogger("rackflow.worker")
HEARTBEAT_SECONDS = 5.0


class WorkerState:
    def __init__(self, worker_id: str) -> None:
        self.worker_id = worker_id
        self.status = "idle"
        self.current_job_id: Any = None
        self.succeeded = 0
        self.failed = 0
        self.started_at = datetime.now(UTC)
        self.lock = threading.Lock()


def _capabilities() -> dict[str, Any]:
    try:
        importlib.import_module("rapidocr_onnxruntime")
        ocr = True
    except ImportError:
        ocr = False
    return {"ocr": ocr, "embedding_provider": get_settings().embedding_provider}


def write_heartbeat(state: WorkerState) -> None:
    with state.lock:
        values = {
            "hostname": socket.gethostname()[:255], "pid": os.getpid(), "status": state.status,
            "current_job_id": state.current_job_id, "jobs_succeeded": state.succeeded,
            "jobs_failed": state.failed, "last_heartbeat_at": datetime.now(UTC),
            "version": __version__,
        }
    stmt = insert(WorkerHeartbeat).values(
        worker_id=state.worker_id, started_at=state.started_at, capabilities=_capabilities(),
        **values,
    ).on_conflict_do_update(index_elements=[WorkerHeartbeat.worker_id], set_=values)
    with get_sessionmaker()() as db:
        db.execute(stmt)
        db.commit()


def _heartbeat_loop(state: WorkerState, stop: threading.Event) -> None:
    while not stop.wait(HEARTBEAT_SECONDS):
        try:
            write_heartbeat(state)
        except Exception:  # noqa: BLE001 — never kill the worker over a heartbeat
            log.warning("heartbeat_failed")


def _load_plugins() -> None:
    """Test-only hook: import modules that register handlers (APP_ENV=test only)."""
    plugins = os.environ.get("RACKFLOW_WORKER_PLUGINS", "")
    if plugins and get_settings().app_env == "test":
        for name in plugins.split(","):
            importlib.import_module(name.strip())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rackflow-worker")
    parser.add_argument("--once", action="store_true", help="process at most one job and exit")
    parser.add_argument("--max-jobs", type=int, default=0)
    parser.add_argument("--exit-when-idle", action="store_true")
    parser.add_argument("--job-types", default="", help="comma-separated job types")
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.log_level)
    _load_plugins()
    worker_id = f"{socket.gethostname()[:40]}-{os.getpid()}-{secrets.token_hex(2)}"
    job_types = [JobType(t.strip()) for t in args.job_types.split(",") if t.strip()] or None
    state = WorkerState(worker_id)
    stop = threading.Event()

    def _stop(signum: int, _frame: Any) -> None:
        log.info("worker_stopping", extra={"signal": signum})
        stop.set()

    for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, name):
            signal.signal(getattr(signal, name), _stop)

    write_heartbeat(state)
    hb_stop = threading.Event()
    threading.Thread(target=_heartbeat_loop, args=(state, hb_stop), daemon=True).start()
    log.info("worker_started", extra={"worker_id": worker_id})
    processed = 0
    try:
        while not stop.is_set():
            with get_sessionmaker()() as db:
                claim = queue.claim_next(db, worker_id, lease_seconds=settings.job_lease_seconds,
                                         job_types=job_types)
            if claim is None:
                if args.once or args.exit_when_idle:
                    break
                stop.wait(settings.worker_poll_interval_seconds)
                continue
            with state.lock:
                state.status, state.current_job_id = "busy", claim.job_id
            write_heartbeat(state)
            outcome = run_claimed_job(claim, worker_id, lease_seconds=settings.job_lease_seconds)
            with state.lock:
                state.status, state.current_job_id = "idle", None
                if outcome == "succeeded":
                    state.succeeded += 1
                elif outcome in ("failed", "retry_wait"):
                    state.failed += 1
            processed += 1
            if args.once or (args.max_jobs and processed >= args.max_jobs):
                break
    finally:
        hb_stop.set()
        with state.lock:
            state.status, state.current_job_id = "stopped", None
        try:
            write_heartbeat(state)
        except Exception:  # noqa: BLE001
            log.warning("final_heartbeat_failed")
        log.info("worker_stopped", extra={"worker_id": worker_id, "processed": processed})
    return 0


if __name__ == "__main__":
    sys.exit(main())
