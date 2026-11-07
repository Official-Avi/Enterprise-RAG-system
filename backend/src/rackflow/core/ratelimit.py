"""In-process sliding-window rate limiter.

Limitation (documented): limits are per API process. With several API replicas the effective
limit multiplies; a shared store (e.g. Redis) is required for exact global limits.
"""

from __future__ import annotations

import math
import threading
import time
from collections import defaultdict, deque
from ipaddress import IPv4Address, IPv6Address, ip_address

from starlette.requests import Request

from rackflow.core.config import get_settings
from rackflow.core.errors import RateLimitedError


class SlidingWindowLimiter:
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._next_sweep = 0.0

    def _sweep(self, now: float) -> None:
        """Forgets idle keys once a window, so keys an attacker invents cannot pile up in memory."""
        if now < self._next_sweep:
            return
        self._next_sweep = now + self.window
        for key in [k for k, q in self._hits.items() if not q or now - q[-1] > self.window]:
            del self._hits[key]

    def hit(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._sweep(now)
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                # Seconds until the oldest hit leaves the window and a slot frees up.
                wait = self.window - (now - q[0])
                raise RateLimitedError(retry_after=max(1, math.ceil(wait)))
            q.append(now)

    def allow(self, key: str) -> bool:
        """`hit` for callers that skip work over the limit instead of refusing the request."""
        try:
            self.hit(key)
        except RateLimitedError:
            return False
        return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


def _parse_ip(value: str) -> IPv4Address | IPv6Address | None:
    try:
        parsed = ip_address(value.strip())
    except ValueError:
        return None
    return (parsed.ipv4_mapped or parsed) if isinstance(parsed, IPv6Address) else parsed


def client_ip(request: Request) -> str:
    """The address to rate limit by: the connecting peer, unless TRUSTED_PROXY_IPS lists that peer.

    Only then is X-Forwarded-For read, from the right, because each proxy appends the address it saw
    and everything further left came from the client. The first address that is not itself a trusted
    proxy is the client. Anything unusable falls back to the peer, which is a shared bucket but one
    a client cannot escape by inventing addresses.
    """
    peer = request.client.host if request.client else "unknown"
    trusted = get_settings().trusted_proxy_networks
    peer_ip = _parse_ip(peer)
    if peer_ip is None or not any(peer_ip in net for net in trusted):
        return peer
    for hop in reversed(",".join(request.headers.getlist("x-forwarded-for")).split(",")):
        hop_ip = _parse_ip(hop)
        if hop_ip is None:
            return peer
        if not any(hop_ip in net for net in trusted):
            return str(hop_ip)
    return peer


login_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)
# All sign-ins from one client, whatever address they try. Checked before the costly password check.
login_client_limiter = SlidingWindowLimiter(limit=60, window_seconds=60)
upload_limiter = SlidingWindowLimiter(limit=60, window_seconds=60)
chat_limiter = SlidingWindowLimiter(limit=30, window_seconds=60)
demo_login_limiter = SlidingWindowLimiter(limit=30, window_seconds=60)
# Caps audit rows for one user repeating one refused call, e.g. a page polling a route its role
# cannot read. It limits only the audit writes; the request itself is refused either way.
denied_audit_limiter = SlidingWindowLimiter(limit=5, window_seconds=60)
# Rejected sign-ins need no account to write a tenant's audit log. These cap the rows and leave the
# 401 unchanged: per client, per tenant (for many clients, or forged addresses), and per account.
anonymous_audit_client_limiter = SlidingWindowLimiter(limit=5, window_seconds=60)
anonymous_audit_tenant_limiter = SlidingWindowLimiter(limit=30, window_seconds=60)
rejected_login_audit_limiter = SlidingWindowLimiter(limit=10, window_seconds=60)


def reset_all() -> None:
    for limiter in (login_limiter, login_client_limiter, upload_limiter, chat_limiter,
                    demo_login_limiter, denied_audit_limiter, anonymous_audit_client_limiter,
                    anonymous_audit_tenant_limiter, rejected_login_audit_limiter):
        limiter.reset()
