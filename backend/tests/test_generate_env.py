"""scripts/ops/generate_env.py writes a production .env that the app accepts, with fresh secrets it
never prints, and never overwrites a file without --force."""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from rackflow.core.config import MIN_DATABASE_PASSWORD_LENGTH, Settings

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "ops" / "generate_env.py"
DOMAIN = "rag.example.com"
SECRET_NAMES = ("POSTGRES_PASSWORD", "VECTOR_STORE_API_KEY", "QDRANT__SERVICE__API_KEY")


def run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True,
                          timeout=60, check=False)


def generate(path: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    result = run("--output", str(path), *extra)
    assert result.returncode == 0, result.stderr
    return result


def parse(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            name, _, value = line.partition("=")
            values[name.strip()] = value
    return values


@pytest.fixture()
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Settings must see the generated file only: drop every setting conftest or the shell set."""
    for name in list(os.environ):
        if name.lower() in Settings.model_fields:
            monkeypatch.delenv(name)


def test_file_validates_as_production_settings(tmp_path: Path, clean_env: None) -> None:
    path = tmp_path / ".env"
    generate(path, "--domain", DOMAIN, "--tls-issuer", "ops@example.com")
    s = Settings(_env_file=str(path))  # only this file: not the repo .env
    assert s.app_env == "production"
    assert s.cookie_secure is True
    assert s.demo_mode is False
    assert s.web_origin == s.api_base_url == f"https://{DOMAIN}"
    assert s.vector_store_api_key is not None
    values = parse(path)
    assert make_url(s.database_url).password == values["POSTGRES_PASSWORD"]
    assert s.vector_store_api_key.get_secret_value() == values["QDRANT__SERVICE__API_KEY"]
    assert values["TLS_ISSUER"] == "ops@example.com"
    assert values["DOMAIN"] == DOMAIN


def test_without_domain_the_app_refuses_to_start(tmp_path: Path, clean_env: None) -> None:
    path = tmp_path / ".env"
    result = generate(path)
    assert "DOMAIN, WEB_ORIGIN, API_BASE_URL" in result.stdout
    assert "TLS_ISSUER" in result.stdout
    with pytest.raises(ValidationError, match="WEB_ORIGIN must be set"):
        Settings(_env_file=str(path))


def test_secrets_are_long_random_and_url_safe(tmp_path: Path) -> None:
    a, b = tmp_path / "a.env", tmp_path / "b.env"
    generate(a, "--domain", DOMAIN)
    generate(b, "--domain", DOMAIN)
    va, vb = parse(a), parse(b)
    for name in ("POSTGRES_PASSWORD", "VECTOR_STORE_API_KEY"):
        assert len(va[name]) >= 43 > MIN_DATABASE_PASSWORD_LENGTH  # 256 bits of randomness
        assert re.fullmatch(r"[A-Za-z0-9_-]+", va[name])
        assert va[name] != vb[name]
    assert va["POSTGRES_PASSWORD"] != va["VECTOR_STORE_API_KEY"]
    assert va["VECTOR_STORE_API_KEY"] == va["QDRANT__SERVICE__API_KEY"]
    assert f":{va['POSTGRES_PASSWORD']}@postgres:5432/" in va["DATABASE_URL"]
    assert va["APP_ENV"] == "production"
    assert va["COOKIE_SECURE"] == "true"
    assert va["DEMO_MODE"] == "false"


def test_output_names_generated_values_but_never_prints_them(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    result = generate(path, "--domain", DOMAIN)
    values = parse(path)
    output = result.stdout + result.stderr
    for name in SECRET_NAMES:
        assert name in output
        assert values[name] not in output
    assert str(path.resolve()) in output
    assert "rackflow-admin bootstrap-admin" in output  # production has no demo accounts
    assert "RACKFLOW_ADMIN_PASSWORD" not in values  # a one-off shell variable, never stored


def test_timeouts_agree_and_log_level_is_production_safe(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    generate(path, "--domain", DOMAIN)
    v = parse(path)
    assert int(v["API_PROXY_TIMEOUT_MS"]) == int(v["WEB_PROXY_TIMEOUT_SECONDS"]) * 1000
    assert int(v["MODEL_TIMEOUT_SECONDS"]) < int(v["WEB_PROXY_TIMEOUT_SECONDS"])
    assert int(v["CADDY_UPSTREAM_TIMEOUT"].removesuffix("s")) > int(v["WEB_PROXY_TIMEOUT_SECONDS"])
    assert v["LOG_LEVEL"] == "INFO"


def test_refuses_to_overwrite_without_force(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    path.write_text("KEEP=me\n", encoding="utf-8")
    result = run("--output", str(path), "--domain", DOMAIN)
    assert result.returncode == 1
    assert "already exists" in result.stderr
    assert path.read_text(encoding="utf-8") == "KEEP=me\n"
    assert list(tmp_path.iterdir()) == [path]  # no stray temporary file


def test_force_replaces_the_file(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    generate(path, "--domain", DOMAIN)
    first = parse(path)["POSTGRES_PASSWORD"]
    generate(path, "--domain", DOMAIN, "--force")
    assert parse(path)["POSTGRES_PASSWORD"] != first
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.skipif(os.name != "posix", reason="POSIX file modes")
def test_file_mode_is_600(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    generate(path, "--domain", DOMAIN)
    assert path.stat().st_mode & 0o777 == 0o600
    generate(path, "--domain", DOMAIN, "--force")
    assert path.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("args", [
    ("--domain", "https://rag.example.com"),
    ("--domain", "rag.example.com:443"),
    ("--domain", "rag example.com"),
    ("--domain", "*.example.com"),
    ("--tls-issuer", "not-an-email"),
    ("--db-host", "postgres/evil"),
])
def test_bad_arguments_write_nothing(tmp_path: Path, args: tuple[str, str]) -> None:
    path = tmp_path / ".env"
    result = run("--output", str(path), *args)
    assert result.returncode == 2
    assert not path.exists()


def test_missing_directory_is_an_error(tmp_path: Path) -> None:
    result = run("--output", str(tmp_path / "missing" / ".env"))
    assert result.returncode == 1
    assert "does not exist" in result.stderr
