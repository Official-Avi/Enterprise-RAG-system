"""Production configuration refuses unsafe values at startup, naming the variable, never the value.

These tests build Settings from keyword arguments only: no `.env` file, and the variables the
suite's conftest exports (DATABASE_URL, APP_ENV, EMBEDDING_PROVIDER, ...) are removed first.
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from rackflow.core.config import Settings, is_internal_host

# Fake, test-only values. Each is distinctive so a leak into an error message is easy to detect.
DB_PASSWORD = "Zq7-test-only-db-secret-4821"
VECTOR_KEY = "vk-test-only-vector-secret-9917"
MODEL_KEY = "mk-test-only-model-secret-3307"
SECRETS = (DB_PASSWORD, VECTOR_KEY, MODEL_KEY)

_ENV_VARS = (
    "APP_ENV", "API_BASE_URL", "WEB_ORIGIN", "LOG_LEVEL", "DATABASE_URL", "VECTOR_STORE_URL",
    "VECTOR_STORE_API_KEY", "MODEL_PROVIDER", "MODEL_NAME", "MODEL_BASE_URL", "MODEL_API_KEY",
    "MODEL_TIMEOUT_SECONDS", "WEB_PROXY_TIMEOUT_SECONDS", "EMBEDDING_PROVIDER", "COOKIE_SECURE",
    "DEMO_MODE", "TRUSTED_PROXY_IPS",
)


@pytest.fixture(autouse=True)
def _isolated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in _ENV_VARS:
        monkeypatch.delenv(name, raising=False)


def production(**overrides: Any) -> dict[str, Any]:
    """A safe production configuration (a Compose-style deployment); override one value per test."""
    values: dict[str, Any] = {
        "_env_file": None,
        "app_env": "production",
        "cookie_secure": True,
        "demo_mode": False,
        "embedding_provider": "fastembed",
        "api_base_url": "https://rackflow.example.com",
        "web_origin": "https://rackflow.example.com",
        "log_level": "INFO",
        "database_url": f"postgresql+psycopg://rackflow:{DB_PASSWORD}@postgres:5432/rackflow",
        "vector_store_url": "http://qdrant:6333",
        "model_provider": "extractive",
        "model_timeout_seconds": 60,
        "web_proxy_timeout_seconds": 120,
    }
    values.update(overrides)
    return values


def refused(match: str, **overrides: Any) -> str:
    with pytest.raises(ValidationError, match=match) as info:
        Settings(**production(**overrides))
    message = str(info.value)
    for secret in SECRETS:
        assert secret not in message, "a configured secret leaked into the validation error"
    return message


def test_safe_production_configuration_is_accepted() -> None:
    s = Settings(**production())
    assert s.app_env == "production" and s.web_proxy_timeout_seconds == 120


def test_development_defaults_are_unchanged() -> None:
    s = Settings(_env_file=None)
    assert s.app_env == "development"
    assert s.web_proxy_timeout_seconds == 120
    # Development keeps accepting everything production refuses.
    Settings(_env_file=None, log_level="DEBUG", model_timeout_seconds=600,
             vector_store_url="http://qdrant.example.com:6333")
    Settings(_env_file=None, app_env="test", database_url="postgresql+psycopg://u@h/rackflow_test")


@pytest.mark.parametrize("url", [
    "postgresql+psycopg://rackflow:rackflow@postgres:5432/rackflow",       # shipped default
    "postgresql+psycopg://rackflow@postgres:5432/rackflow",                # no password
    "postgresql+psycopg://rackflow:@postgres:5432/rackflow",               # empty password
    "postgresql+psycopg://rackflow:short-pass@postgres:5432/rackflow",     # too short
    "postgresql+psycopg://admin-user-long:admin-user-long@db:5432/rackflow",  # password = user
])
def test_weak_database_credentials_are_refused(url: str) -> None:
    refused("DATABASE_URL", database_url=url)


def test_unparseable_database_url_is_refused_without_echoing_it() -> None:
    message = refused("DATABASE_URL", database_url=f"not a url {DB_PASSWORD}")
    assert "not a valid database URL" in message


@pytest.mark.parametrize("origin", [
    "http://rackflow.example.com",
    "https://rackflow.example.com,http://other.example.com",
    "rackflow.example.com",
    "",
])
def test_web_origin_must_be_https(origin: str) -> None:
    refused("WEB_ORIGIN", web_origin=origin)


def test_several_https_origins_are_accepted() -> None:
    s = Settings(**production(web_origin="https://a.example.com, https://b.example.com"))
    assert s.cors_origins == ["https://a.example.com", "https://b.example.com"]


@pytest.mark.parametrize("url", ["http://127.0.0.1:8000", "http://api.example.com", "https://"])
def test_api_base_url_must_be_https(url: str) -> None:
    refused("API_BASE_URL", api_base_url=url)


@pytest.mark.parametrize("url", [
    "http://qdrant:6333", "http://localhost:6333", "http://127.0.0.1:6333", "http://10.0.4.7:6333",
    "http://172.30.0.20:6333", "http://[::1]:6333", "http://qdrant.rackflow.svc.cluster.local:6333",
])
def test_private_vector_store_needs_no_key(url: str) -> None:
    assert Settings(**production(vector_store_url=url)).vector_store_api_key is None


def test_remote_vector_store_needs_https_and_a_key() -> None:
    refused("VECTOR_STORE_API_KEY", vector_store_url="https://xyz.cloud.qdrant.io:6333")
    refused("VECTOR_STORE_API_KEY", vector_store_url="https://xyz.cloud.qdrant.io:6333",
            vector_store_api_key="  ")
    refused("VECTOR_STORE_URL", vector_store_url="http://xyz.cloud.qdrant.io:6333",
            vector_store_api_key=VECTOR_KEY)
    refused("VECTOR_STORE_URL", vector_store_url="http://169.254.169.254:6333",
            vector_store_api_key=VECTOR_KEY)  # link-local is not a private network
    s = Settings(**production(vector_store_url="https://xyz.cloud.qdrant.io:6333",
                              vector_store_api_key=VECTOR_KEY))
    assert s.vector_store_api_key is not None


@pytest.mark.parametrize("url", ["qdrant:6333", "ftp://qdrant:6333", "http://"])
def test_vector_store_url_must_be_http_or_https(url: str) -> None:
    refused("VECTOR_STORE_URL", vector_store_url=url)


def test_hosted_model_providers_need_a_key() -> None:
    refused("MODEL_API_KEY", model_provider="anthropic", model_name="claude",
            model_api_key="   ")
    refused("MODEL_API_KEY", model_provider="openai_compatible", model_name="m",
            model_base_url="https://api.example.com/v1")
    Settings(**production(model_provider="anthropic", model_name="claude",
                          model_api_key=MODEL_KEY))
    Settings(**production(model_provider="openai_compatible", model_name="m",
                          model_base_url="https://api.example.com/v1", model_api_key=MODEL_KEY))


@pytest.mark.parametrize("base_url", [
    "http://ollama:11434/v1", "http://localhost:11434/v1", "http://192.168.1.20:11434/v1",
])
def test_self_hosted_model_needs_no_key(base_url: str) -> None:
    Settings(**production(model_provider="openai_compatible", model_name="llama",
                          model_base_url=base_url))


def test_remote_model_endpoint_must_use_https() -> None:
    refused("MODEL_BASE_URL", model_provider="openai_compatible", model_name="m",
            model_base_url="http://api.example.com/v1", model_api_key=MODEL_KEY)


@pytest.mark.parametrize("level", ["DEBUG", "debug", " Debug ", "NOTSET"])
def test_debug_logging_is_refused(level: str) -> None:
    refused("LOG_LEVEL", log_level=level)


@pytest.mark.parametrize("level", ["INFO", "warning", "ERROR"])
def test_info_or_stricter_logging_is_accepted(level: str) -> None:
    Settings(**production(log_level=level))


def test_model_timeout_must_be_below_the_web_proxy_timeout() -> None:
    refused("MODEL_TIMEOUT_SECONDS", model_timeout_seconds=120)
    refused("MODEL_TIMEOUT_SECONDS", model_timeout_seconds=300)
    refused("MODEL_TIMEOUT_SECONDS", model_timeout_seconds=300, web_proxy_timeout_seconds=300)
    Settings(**production(model_timeout_seconds=119))
    Settings(**production(model_timeout_seconds=300, web_proxy_timeout_seconds=330))


def test_web_proxy_timeout_is_read_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEB_PROXY_TIMEOUT_SECONDS", "330")
    assert Settings(_env_file=None).web_proxy_timeout_seconds == 330
    monkeypatch.setenv("WEB_PROXY_TIMEOUT_SECONDS", "0")
    with pytest.raises(ValidationError, match="web_proxy_timeout_seconds"):
        Settings(_env_file=None)


def test_errors_from_the_environment_do_not_echo_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    """The real startup path: values come from environment variables, not keyword arguments."""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("EMBEDDING_PROVIDER", "fastembed")
    monkeypatch.setenv("API_BASE_URL", "https://rackflow.example.com")
    monkeypatch.setenv("WEB_ORIGIN", "https://rackflow.example.com")
    monkeypatch.setenv("DATABASE_URL",
                       f"postgresql+psycopg://rackflow:{DB_PASSWORD}@postgres:5432/rackflow")
    monkeypatch.setenv("VECTOR_STORE_URL", "https://xyz.cloud.qdrant.io:6333")
    monkeypatch.setenv("MODEL_PROVIDER", "anthropic")
    monkeypatch.setenv("MODEL_NAME", "claude")
    monkeypatch.setenv("MODEL_API_KEY", MODEL_KEY)
    with pytest.raises(ValidationError, match="VECTOR_STORE_API_KEY") as info:
        Settings(_env_file=None)
    for secret in SECRETS:
        assert secret not in str(info.value)
    # Field-level errors (bad types) must not echo values either.
    monkeypatch.setenv("MODEL_TIMEOUT_SECONDS", f"x{MODEL_KEY}")
    with pytest.raises(ValidationError) as info:
        Settings(_env_file=None)
    assert MODEL_KEY not in str(info.value)


@pytest.mark.parametrize(("host", "internal"), [
    ("localhost", True), ("qdrant", True), ("db.internal", True), ("10.1.2.3", True),
    ("::1", True), ("[fd00::1]", True), ("printer.local", True),
    ("example.com", False), ("8.8.8.8", False), ("169.254.169.254", False), ("0.0.0.0", False),  # noqa: S104
    (None, False), ("", False),
])
def test_internal_host_classification(host: str | None, internal: bool) -> None:
    assert is_internal_host(host) is internal
