"""Production credential hardening: password policy, production-guarded seeding, the
bootstrap-admin command, and demo sign-in refused in production whatever DEMO_MODE says."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import ColumnElement, func, select

from rackflow import cli
from rackflow.auth.passwords import (
    MIN_PASSWORD_LENGTH,
    WeakPasswordError,
    check_password_policy,
    password_problems,
    verify_password,
)
from rackflow.core.config import Settings, get_settings
from rackflow.db.models import AuditEvent, Role, Tenant, TenantMembership, User
from rackflow.db.session import session_scope
from tests.conftest import TEST_PASSWORD, Factory

STRONG = "Tidal-Granite-Lantern-82"  # not a secret: only ever used inside the test database


# ---------- password policy (no database) ----------

@pytest.mark.parametrize("weak", [
    "short-Pw1!",                     # under 12 characters
    "password1234", "Password!2024", "P@ssw0rd-2024!", "qwertyuiop12",
    "letmein-letmein", "changeme12345", "admin1234567", "123456789012",
    "correct horse battery staple",   # famous, and the test suite's own fixture password
    "rackflow-demo-2026", "aaaaaaaaaaaaaa", "abababababab",
])
def test_policy_refuses_short_common_and_repetitive_passwords(weak: str) -> None:
    with pytest.raises(WeakPasswordError):
        check_password_policy(weak)


def test_policy_refuses_the_email_name_and_never_echoes_the_password() -> None:
    pw = "jane.doe-Rivers-77"
    with pytest.raises(WeakPasswordError) as err:
        check_password_policy("XyJaneDoe-Rivers-77", emails=("jane.doe@example.com",))
    assert "email name" in str(err.value) and "Rivers" not in str(err.value)
    # Each part of a dotted local part counts too, case-insensitively.
    assert password_problems("Quiet-JANE-Harbour-9", emails=("jane.doe@example.com",)) == [
        "must not contain the account's email name"]
    assert password_problems(pw) == []  # without the email it is fine
    assert password_problems("x" * 513) != []


def test_policy_accepts_a_strong_password() -> None:
    assert len(STRONG) >= MIN_PASSWORD_LENGTH
    assert password_problems(STRONG, emails=("admin@acme.example.com",)) == []


def test_generated_passwords_pass_the_policy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RF_TEST_UNSET_PW", raising=False)
    for _ in range(50):
        pw, generated = cli._password("RF_TEST_UNSET_PW", emails=("admin@acme.example.com",))
        assert generated and password_problems(pw, emails=("admin@acme.example.com",)) == []


def test_policy_does_not_touch_login_or_hashing_of_existing_passwords() -> None:
    """The API's create-member path and existing accounts keep the plain length rule."""
    from rackflow.auth.passwords import hash_password

    h = hash_password(TEST_PASSWORD)  # a well-known phrase: refused for NEW CLI passwords only
    assert verify_password(TEST_PASSWORD, h)
    with pytest.raises(WeakPasswordError):
        check_password_policy(TEST_PASSWORD)


# ---------- CLI (integration: needs the test database) ----------

@pytest.fixture()
def production(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the CLI and the demo module believe APP_ENV=production. model_copy skips the
    validator, which is exactly the 'somehow' the defence in depth is for."""
    prod = get_settings().model_copy(update={"app_env": "production"})
    monkeypatch.setattr(cli, "get_settings", lambda: prod)


def _count(model: type, *where: ColumnElement[bool]) -> int:
    with session_scope() as s:
        return s.scalar(select(func.count()).select_from(model).where(*where)) or 0


Run = Callable[..., tuple[int, str, str]]


@pytest.fixture()
def run(capsys: pytest.CaptureFixture[str]) -> Run:
    def _run(*argv: str) -> tuple[int, str, str]:
        code = cli.main(list(argv))
        out = capsys.readouterr()
        return code, out.out, out.err
    return _run


@pytest.mark.integration
@pytest.mark.usefixtures("client", "production")
def test_seed_demo_refuses_in_production_without_the_flag(
    run: Run, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("RACKFLOW_SEED_PASSWORD", STRONG)
    code, out, err = run("seed-demo")
    assert code == 2 and "APP_ENV=production" in err and "--allow-in-production" in err
    assert _count(User) == 0 and _count(Tenant) == 0

    code, out, _ = run("seed-demo", "--allow-in-production")
    assert code == 0 and _count(User) == len(cli.DEMO_USERS)
    assert STRONG not in out  # a supplied password is never printed


@pytest.mark.integration
@pytest.mark.usefixtures("client", "production")
def test_seed_eval_refuses_in_production_without_the_flag(run: Run) -> None:
    code, _, err = run("seed-eval", "--tenant", "acme", "--owner-email", "a@acme.example.com")
    assert code == 2 and "seed-eval" in err
    # With the flag it gets past the guard (and then finds no such tenant).
    code, out, _ = run("seed-eval", "--tenant", "acme", "--owner-email", "a@acme.example.com",
                       "--allow-in-production")
    assert code == 1 and "not found" in out


@pytest.mark.integration
@pytest.mark.usefixtures("client")
@pytest.mark.parametrize("weak", ["short-pw", "password1234", "Engineer-Rivers-77"])
def test_seed_demo_refuses_weak_passwords_and_writes_nothing(
    run: Run, monkeypatch: pytest.MonkeyPatch, weak: str
) -> None:
    monkeypatch.setenv("RF_TEST_SEED_PW", weak)
    code, out, err = run("seed-demo", "--password-env", "RF_TEST_SEED_PW")
    assert code == 2 and "RF_TEST_SEED_PW" in err and weak not in err + out
    assert _count(User) == 0 and _count(Tenant) == 0


@pytest.mark.integration
@pytest.mark.usefixtures("client")
def test_seed_demo_keeps_its_password_env_interface(
    run: Run, monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    monkeypatch.setenv("RF_TEST_SEED_PW", STRONG)
    code, out, _ = run("seed-demo", "--password-env", "RF_TEST_SEED_PW")
    assert code == 0 and "$RF_TEST_SEED_PW" in out and STRONG not in out
    r = client.post("/api/v1/auth/login", json={
        "email": "engineer@acme.example.com", "password": STRONG, "tenant_slug": "acme",
        "mode": "token"})
    assert r.status_code == 200, r.text


@pytest.mark.integration
@pytest.mark.usefixtures("client")
def test_create_user_applies_the_policy(run: Run, monkeypatch: pytest.MonkeyPatch) -> None:
    args = ("create-user", "--email", "kim.lee@acme.example.com", "--name", "Kim",
            "--tenant", "acme", "--role", "engineer", "--password-env", "RF_TEST_NEW_PW")
    monkeypatch.setenv("RF_TEST_NEW_PW", "kim.lee-Harbour-1")
    code, _, err = run(*args)
    assert code == 2 and "email name" in err and _count(User) == 0

    monkeypatch.setenv("RF_TEST_NEW_PW", STRONG)
    code, out, _ = run(*args)
    assert code == 0 and "Created" in out and STRONG not in out


@pytest.mark.integration
@pytest.mark.usefixtures("client")
def test_bootstrap_admin_creates_the_first_admin_and_prints_a_generated_password_once(
    run: Run, monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    monkeypatch.delenv("RACKFLOW_ADMIN_PASSWORD", raising=False)
    code, out, _ = run("bootstrap-admin", "--tenant", "initech", "--tenant-name", "Initech",
                       "--email", "Owner@Initech.example.com")
    assert code == 0, out
    lines = [ln for ln in out.splitlines() if "Generated password" in ln]
    assert len(lines) == 1
    password = lines[0].rsplit(": ", 1)[1]
    assert password_problems(password, emails=("owner@initech.example.com",)) == []

    r = client.post("/api/v1/auth/login", json={
        "email": "owner@initech.example.com", "password": password, "tenant_slug": "initech",
        "mode": "token"})
    assert r.status_code == 200 and r.json()["role"] == "org_admin"
    assert _count(AuditEvent, AuditEvent.action == "member.bootstrap_admin") == 1


@pytest.mark.integration
@pytest.mark.usefixtures("client")
def test_bootstrap_admin_uses_the_password_env_and_refuses_a_second_admin(
    run: Run, monkeypatch: pytest.MonkeyPatch, factory: Factory
) -> None:
    monkeypatch.setenv("RF_TEST_ADMIN_PW", STRONG)
    base = ("bootstrap-admin", "--tenant", "initech", "--tenant-name", "Initech",
            "--password-env", "RF_TEST_ADMIN_PW")
    code, out, _ = run(*base, "--email", "first@initech.example.com")
    assert code == 0 and "$RF_TEST_ADMIN_PW" in out and STRONG not in out

    code, _, err = run(*base, "--email", "second@initech.example.com")
    assert code == 2 and "already has an admin" in err
    assert _count(User, User.email == "second@initech.example.com") == 0

    # A tenant that already has an admin from elsewhere is refused too.
    factory.actor(Role.ORG_ADMIN, tenant="acme")
    code, _, err = run("bootstrap-admin", "--tenant", "acme", "--tenant-name", "Acme",
                       "--email", "late@acme.example.com", "--password-env", "RF_TEST_ADMIN_PW")
    assert code == 2 and _count(User, User.email == "late@acme.example.com") == 0


@pytest.mark.integration
@pytest.mark.usefixtures("client")
def test_bootstrap_admin_refuses_weak_password_and_bad_input(
    run: Run, monkeypatch: pytest.MonkeyPatch
) -> None:
    base = ("bootstrap-admin", "--tenant", "initech", "--tenant-name", "Initech",
            "--password-env", "RF_TEST_ADMIN_PW")
    monkeypatch.setenv("RF_TEST_ADMIN_PW", "changeme")
    code, _, err = run(*base, "--email", "owner@initech.example.com")
    assert code == 2 and "changeme" not in err
    monkeypatch.setenv("RF_TEST_ADMIN_PW", STRONG)
    assert run(*base, "--email", "not-an-email")[0] == 2
    assert run("bootstrap-admin", "--tenant", "Bad Slug!", "--tenant-name", "X",
               "--email", "owner@initech.example.com", "--password-env", "RF_TEST_ADMIN_PW"
               )[0] == 2
    assert _count(User) == 0 and _count(Tenant) == 0 and _count(TenantMembership) == 0


# ---------- demo sign-in: defence in depth ----------

def test_demo_enabled_is_false_in_production_even_if_demo_mode_is_true() -> None:
    from rackflow.auth.demo import demo_enabled

    base = Settings(_env_file=None)
    assert demo_enabled(base.model_copy(update={"demo_mode": True})) is True
    assert demo_enabled(base.model_copy(update={"demo_mode": False})) is False
    assert demo_enabled(base.model_copy(update={"demo_mode": True,
                                                "app_env": "production"})) is False


@pytest.mark.integration
def test_demo_sign_in_is_refused_in_production_even_if_demo_mode_is_true(
    client: TestClient, factory: Factory, monkeypatch: pytest.MonkeyPatch
) -> None:
    from rackflow.api.routers import auth
    from rackflow.auth import demo

    factory.actor(Role.ENGINEER, email="engineer@acme.example.com")
    # Bypass the validator that forbids this combination, as a misconfiguration might.
    bad = get_settings().model_copy(update={"demo_mode": True, "app_env": "production"})
    monkeypatch.setattr(auth, "get_settings", lambda: bad)
    monkeypatch.setattr(demo, "get_settings", lambda: bad)

    assert demo.find_persona("engineer") is None
    client.cookies.clear()
    r = client.post("/api/v1/auth/demo", json={"persona": "engineer"})
    assert r.status_code == 404 and "rf_session" not in r.cookies
    assert client.get("/api/v1/auth/demo").json()["personas"] == []
