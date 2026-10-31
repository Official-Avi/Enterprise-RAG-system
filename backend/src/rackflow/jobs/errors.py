"""Error classification for job handlers.

Handlers raise these so the job runner can decide between retry (with backoff) and terminal
failure. `safe_message` is shown in the UI: no paths, stack traces, or document content.
A library that cannot be loaded (see `is_dependency_failure`) is permanent with code
`DEPENDENCY_UNAVAILABLE`; any other exception is retryable with code `INTERNAL_ERROR`.
"""

from __future__ import annotations

DEPENDENCY_UNAVAILABLE = "DEPENDENCY_UNAVAILABLE"
DEPENDENCY_MESSAGE = ("A required processing component could not be loaded. "
                      "An administrator needs to check the server.")
# Windows loader errors: module not found, procedure not found, bad image, DLL init failed.
_DLL_LOAD_WINERRORS = frozenset({126, 127, 193, 1114})


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


class DependencyUnavailable(PermanentJobError):
    """A library or native component cannot be loaded on this host. Every retry on the same host
    fails the same way, so the job fails at once and an administrator has to fix the server."""

    def __init__(self) -> None:
        super().__init__(DEPENDENCY_UNAVAILABLE, DEPENDENCY_MESSAGE)


class JobCancelled(Exception):
    """Raised by `JobContext.check_cancelled()` when cancellation was requested."""


def is_dependency_failure(exc: BaseException) -> bool:
    """True when `exc`, or anything it was raised from, is a deterministic import or native
    library load failure. Other OSErrors (connection refused, timeouts, missing files) stay
    transient: only loader errors count."""
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ImportError):  # includes ModuleNotFoundError
            return True
        if isinstance(current, OSError) and (
            getattr(current, "winerror", None) in _DLL_LOAD_WINERRORS
            or "shared object file" in str(current)  # dlopen failure on Linux
        ):
            return True
        current = current.__cause__ or current.__context__
    return False


def dependency_name(exc: BaseException) -> str | None:
    """The module that failed to import, for logs (a module name is never sensitive)."""
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, ImportError) and current.name:
            return current.name
        current = current.__cause__ or current.__context__
    return None
