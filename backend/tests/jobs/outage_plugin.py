"""Worker plugin for the database-outage test (loaded via RACKFLOW_WORKER_PLUGINS, APP_ENV=test).

The handler touches no database, so a job can finish while the database is down and only the
write of its outcome is at risk."""

from __future__ import annotations

import time

from rackflow.db.models import JobType
from rackflow.jobs.context import JobContext
from rackflow.jobs.registry import register_handler


def _handler(ctx: JobContext) -> None:
    time.sleep(float(ctx.payload.get("sleep_seconds", 0)))


register_handler(JobType.EVALUATION_RUN, _handler)
