"""Worker plugin for the crash-recovery test (loaded via RACKFLOW_WORKER_PLUGINS, APP_ENV=test).

Attempt 1 blocks forever (the test kills the process); later attempts succeed."""

from __future__ import annotations

import time

from rackflow.db.models import JobType
from rackflow.jobs.context import JobContext
from rackflow.jobs.registry import register_handler


def _handler(ctx: JobContext) -> None:
    if ctx.attempt_number == 1:
        time.sleep(600)
    ctx.payload.setdefault("done", True)


register_handler(JobType.EVALUATION_RUN, _handler)
