"""Job type → handler. Handlers are imported lazily so the worker only loads what it runs."""

from __future__ import annotations

import importlib
from collections.abc import Callable

from rackflow.db.models import JobType
from rackflow.jobs.context import JobContext
from rackflow.jobs.errors import PermanentJobError

Handler = Callable[[JobContext], None]

_HANDLER_PATHS: dict[JobType, str] = {
    JobType.INGEST_DOCUMENT: "rackflow.ingestion.orchestrator:process_document",
    JobType.DELETE_DOCUMENT: "rackflow.ingestion.deletion:delete_document",
    JobType.EVALUATION_RUN: "rackflow.evaluation.runner:run_evaluation",
}
_overrides: dict[JobType, Handler] = {}


def register_handler(job_type: JobType, handler: Handler) -> None:
    """Override a handler (tests and plugins)."""
    _overrides[job_type] = handler


def clear_overrides() -> None:
    _overrides.clear()


def get_handler(job_type: JobType) -> Handler:
    if job_type in _overrides:
        return _overrides[job_type]
    path = _HANDLER_PATHS.get(job_type)
    if path is None:
        raise PermanentJobError("HANDLER_UNAVAILABLE", "No handler is registered for this job.")
    module_name, _, attr = path.partition(":")
    try:
        handler: Handler = getattr(importlib.import_module(module_name), attr)
    except (ImportError, AttributeError) as exc:
        raise PermanentJobError("HANDLER_UNAVAILABLE",
                                "No handler is available for this job.") from exc
    return handler
