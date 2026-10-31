"""In-process sliding-window rate limiter.

Limitation (documented): limits are per API process. With several API replicas the effective
limit multiplies; a shared store (e.g. Redis) is required for exact global limits.
"""

from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque

from rackflow.core.errors import RateLimitedError


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def hit(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                # Seconds until the oldest hit leaves the window and a slot frees up.
                wait = self.window - (now - q[0])
                raise RateLimitedError(retry_after=max(1, math.ceil(wait)))
            q.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


login_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)
upload_limiter = SlidingWindowLimiter(limit=60, window_seconds=60)
chat_limiter = SlidingWindowLimiter(limit=30, window_seconds=60)
demo_login_limiter = SlidingWindowLimiter(limit=30, window_seconds=60)


def reset_all() -> None:
    for limiter in (login_limiter, upload_limiter, chat_limiter, demo_login_limiter):
        limiter.reset()
