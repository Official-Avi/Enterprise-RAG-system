"""One-click demo personas (DEMO_MODE only).

The landing page lists these personas and logs a visitor in as one of them through
`POST /auth/demo`. Passwords never leave the server: the endpoint opens a session for the seeded
user directly. Personas map onto the accounts created by `rackflow-admin seed-demo`; a persona
whose account does not exist is simply not offered. DEMO_MODE is refused in production by the
settings validator, and again here: `demo_enabled()` and `find_persona()` never offer a persona when
APP_ENV=production, even if demo_mode were somehow true (defence in depth).
Copy follows Docs/UI_DESIGN_SPEC.md §4.1 (≤ 3 "can" lines, ≤ 2 "can't" lines).
"""

from __future__ import annotations

from dataclasses import dataclass

from rackflow.core.config import Settings, get_settings


@dataclass(frozen=True)
class DemoPersona:
    key: str
    email: str
    tenant_slug: str
    title: str
    summary: str
    can: tuple[str, ...]
    cannot: tuple[str, ...]


DEMO_PERSONAS: tuple[DemoPersona, ...] = (
    DemoPersona(
        key="engineer",
        email="engineer@acme.example.com",
        tenant_slug="acme",
        title="Engineer",
        summary="Upload files and ask questions about them.",
        can=("Upload files", "Ask questions with cited answers", "Make collections"),
        cannot=("Open the admin console",),
    ),
    DemoPersona(
        key="operator",
        email="operator@acme.example.com",
        tenant_slug="acme",
        title="Operator",
        summary="Keeps file processing running smoothly.",
        can=("Ask questions", "Watch the processing queue", "Retry failed files"),
        cannot=("Upload files",),
    ),
    DemoPersona(
        key="admin",
        email="admin@acme.example.com",
        tenant_slug="acme",
        title="Admin",
        summary="Does everything, including people and settings.",
        can=("Upload and ask", "Manage users and roles", "Change settings"),
        cannot=(),
    ),
    DemoPersona(
        key="auditor",
        email="auditor@acme.example.com",
        tenant_slug="acme",
        title="Auditor",
        summary="Checks who did what, without seeing content.",
        can=("Read the audit log", "See file names and statuses"),
        cannot=("Open documents or ask questions",),
    ),
)


def demo_enabled(settings: Settings | None = None) -> bool:
    """True only when DEMO_MODE is on and this is not a production deployment."""
    settings = settings or get_settings()
    return bool(settings.demo_mode) and settings.app_env != "production"


def find_persona(key: str) -> DemoPersona | None:
    """The persona with this key, or None. Always None in production, so a demo sign-in can never
    open a session there whatever DEMO_MODE says."""
    if get_settings().app_env == "production":
        return None
    return next((p for p in DEMO_PERSONAS if p.key == key), None)
