"""Error classification for job handlers.

Handlers raise these so the job runner can decide between retry (with backoff) and terminal
failure. `safe_message` is shown in the UI: no paths, stack traces, or document content.
Any other exception is treated as retryable with code `INTERNAL_ERROR`.
"""

from __future__ import annotations


class JobError(Exception):
    retryable = True

    def __init__(self, code: str, safe_message: str) -> None:
        super().__init__(f"{code}: {safe_message}")
        self.code = code
        self.safe_message = safe_message[:500]


class RetryableJobError(JobError):
    """Transient: dependency down, timeout, lock contention."""

    retryable = True


class PermanentJobError(JobError):
    """Invalid input: corrupt/empty/unsupported file, quality too low, document deleted."""

    retryable = False


class JobCancelled(Exception):
    """Raised by `JobContext.check_cancelled()` when cancellation was requested."""
