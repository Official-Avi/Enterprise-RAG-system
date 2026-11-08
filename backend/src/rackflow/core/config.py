"""Typed application configuration loaded from environment variables (and `.env` in development).

Validation happens at startup so a misconfigured deployment fails fast with an actionable,
secret-free message instead of failing later on a request path.
"""

from __future__ import annotations

from functools import lru_cache
from ipaddress import IPv4Network, IPv6Network, ip_address, ip_network
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

REPO_ROOT = Path(__file__).resolve().parents[4]

# Production refuses database passwords shorter than this (generated secrets are much longer).
MIN_DATABASE_PASSWORD_LENGTH = 16
# The development credentials shipped in .env.example and docker-compose.yml.
_DEFAULT_DATABASE_PASSWORDS = frozenset({"rackflow"})
# DNS suffixes that only resolve inside a private network (Docker, Kubernetes, mDNS, RFC 8375).
_INTERNAL_DNS_SUFFIXES = (".localhost", ".internal", ".local", ".lan", ".home.arpa", ".svc",
                          ".cluster.local")


def is_internal_host(host: str | None) -> bool:
    """True for loopback/private IPs, `localhost`, single-label names such as Compose service
    names (`qdrant`), and internal-only DNS suffixes. A heuristic on the configured name: it
    does not resolve DNS, so a public name that resolves privately is still treated as public."""
    if not host:
        return False
    host = host.strip("[]").rstrip(".").lower()
    try:
        addr = ip_address(host)
    except ValueError:
        return host == "localhost" or "." not in host or host.endswith(_INTERNAL_DNS_SUFFIXES)
    return addr.is_loopback or (addr.is_private and not addr.is_link_local
                                and not addr.is_unspecified)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
        # Validation errors must never echo configured values: the input holds passwords and keys.
        hide_input_in_errors=True,
    )

    app_env: Literal["development", "test", "production"] = "development"
    api_base_url: str = "http://127.0.0.1:8000"
    web_origin: str = "http://localhost:3000"
    log_level: str = "INFO"

    database_url: str = "postgresql+psycopg://rackflow:rackflow@127.0.0.1:5432/rackflow"

    vector_store_url: str = "http://127.0.0.1:6333"
    vector_store_api_key: SecretStr | None = None
    vector_collection: str = "rackflow_chunks"

    object_storage_mode: Literal["local"] = "local"
    object_storage_path: Path = REPO_ROOT / ".data" / "objects"

    model_provider: Literal["extractive", "anthropic", "openai_compatible"] = "extractive"
    model_name: str = ""
    model_base_url: str = ""
    model_api_key: SecretStr | None = None
    model_timeout_seconds: float = Field(default=60.0, gt=0, le=600)
    # How long the web's /api proxy waits for the API: must equal API_PROXY_TIMEOUT_MS / 1000 in the
    # web container. Production requires MODEL_TIMEOUT_SECONDS to be below it.
    web_proxy_timeout_seconds: float = Field(default=120.0, gt=0, le=3600)
    model_max_concurrency: int = Field(default=4, ge=1, le=256)

    embedding_provider: Literal["fastembed", "hash"] = "fastembed"
    embedding_model: str = "BAAI/bge-small-en-v1.5"

    upload_max_bytes: int = Field(default=25 * 1024 * 1024, ge=1024)
    upload_max_pages: int = Field(default=500, ge=1)
    ocr_enabled: bool = True
    chunk_size_tokens: int = Field(default=400, ge=50, le=2000)
    chunk_overlap_tokens: int = Field(default=60, ge=0, le=500)

    retrieval_top_k: int = Field(default=6, ge=1, le=50)
    retrieval_score_threshold: float = Field(default=0.45, ge=0.0, le=1.0)

    job_max_attempts: int = Field(default=4, ge=1, le=20)
    job_lease_seconds: int = Field(default=120, ge=10)
    worker_poll_interval_seconds: float = Field(default=1.0, gt=0)

    session_ttl_hours: int = Field(default=12, ge=1, le=24 * 30)
    cookie_secure: bool = False
    auth_issuer: str = ""
    demo_mode: bool = False  # one-click demo personas on the landing page; never in production
    # Peers allowed to state the client's address in X-Forwarded-For. Empty trusts nobody.
    trusted_proxy_ips: str = ""

    @field_validator("object_storage_path", mode="after")
    @classmethod
    def _absolute_storage(cls, v: Path) -> Path:
        return v if v.is_absolute() else (REPO_ROOT / v).resolve()

    @model_validator(mode="after")
    def _cross_field_checks(self) -> Settings:
        if self.chunk_overlap_tokens >= self.chunk_size_tokens:
            raise ValueError("CHUNK_OVERLAP_TOKENS must be smaller than CHUNK_SIZE_TOKENS")
        if self.model_provider == "anthropic" and not self.model_api_key:
            raise ValueError("MODEL_PROVIDER=anthropic requires MODEL_API_KEY to be set")
        if self.model_provider == "openai_compatible" and not self.model_base_url:
            raise ValueError("MODEL_PROVIDER=openai_compatible requires MODEL_BASE_URL")
        if self.model_provider == "openai_compatible" and not self.model_name.strip():
            raise ValueError("MODEL_PROVIDER=openai_compatible requires MODEL_NAME")
        self._check_trusted_proxies()
        if self.app_env == "production":
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true in production")
            if self.embedding_provider == "hash":
                raise ValueError("EMBEDDING_PROVIDER=hash is a test-only provider")
            if self.demo_mode:
                raise ValueError("DEMO_MODE must be false in production")
            self._check_production()
        return self

    def _check_production(self) -> None:
        """Refuse unsafe production values. Messages name the variable, never its value."""
        self._check_production_database()
        for origin in self.web_origin.split(","):
            if origin.strip() and not _is_https_url(origin.strip()):
                raise ValueError("WEB_ORIGIN must list only https:// origins in production")
        if not self.cors_origins:
            raise ValueError("WEB_ORIGIN must be set in production")
        if not _is_https_url(self.api_base_url.strip()):
            raise ValueError("API_BASE_URL must be an https:// URL in production")

        vector = urlsplit(self.vector_store_url.strip())
        if vector.scheme not in ("http", "https") or not vector.hostname:
            raise ValueError("VECTOR_STORE_URL must be an http:// or https:// URL")
        if not is_internal_host(vector.hostname):
            if vector.scheme != "https":
                raise ValueError(
                    "VECTOR_STORE_URL must use https:// when Qdrant is not on a private network")
            if not _secret_set(self.vector_store_api_key):
                raise ValueError(
                    "VECTOR_STORE_API_KEY is required when VECTOR_STORE_URL is not on a private "
                    "network")

        if self.model_provider == "openai_compatible":
            base = urlsplit(self.model_base_url.strip())
            if not is_internal_host(base.hostname):
                if base.scheme != "https":
                    raise ValueError("MODEL_BASE_URL must use https:// unless it is a private "
                                     "(self-hosted) address")
                if not _secret_set(self.model_api_key):
                    raise ValueError("MODEL_API_KEY is required unless MODEL_BASE_URL is a "
                                     "private (self-hosted) address")
        if self.model_provider == "anthropic" and not _secret_set(self.model_api_key):
            raise ValueError("MODEL_API_KEY is required for MODEL_PROVIDER=anthropic")

        if self.log_level.strip().upper() in ("DEBUG", "NOTSET"):
            raise ValueError("LOG_LEVEL must be INFO or stricter in production")
        if self.model_timeout_seconds >= self.web_proxy_timeout_seconds:
            raise ValueError("MODEL_TIMEOUT_SECONDS must be below WEB_PROXY_TIMEOUT_SECONDS in "
                             "production, so a slow answer fails in the API before the web proxy "
                             "gives up")

    def _check_production_database(self) -> None:
        try:
            url = make_url(self.database_url)
        except (ArgumentError, ValueError):
            # `from None`: the parser's own message quotes the URL, password included.
            raise ValueError("DATABASE_URL is not a valid database URL") from None
        password = url.password
        if not password:
            raise ValueError("DATABASE_URL must include a password in production")
        if password in _DEFAULT_DATABASE_PASSWORDS or password == url.username:
            raise ValueError("DATABASE_URL uses the default development credentials; set a "
                             "generated password in production")
        if len(password) < MIN_DATABASE_PASSWORD_LENGTH:
            raise ValueError(f"DATABASE_URL password must be at least "
                             f"{MIN_DATABASE_PASSWORD_LENGTH} characters in production")

    def _check_trusted_proxies(self) -> None:
        for entry in self.trusted_proxy_ips.split(","):
            if not entry.strip():
                continue
            try:
                network = ip_network(entry.strip(), strict=False)
            except ValueError as exc:
                raise ValueError(
                    "TRUSTED_PROXY_IPS must list IP addresses or CIDR ranges"
                ) from exc
            if network.prefixlen == 0:
                raise ValueError("TRUSTED_PROXY_IPS must not trust every address")

    @property
    def trusted_proxy_networks(self) -> list[IPv4Network | IPv6Network]:
        return [ip_network(e.strip(), strict=False)
                for e in self.trusted_proxy_ips.split(",") if e.strip()]

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.web_origin.split(",") if o.strip()]


def _is_https_url(value: str) -> bool:
    parts = urlsplit(value)
    return parts.scheme == "https" and bool(parts.hostname)


def _secret_set(value: SecretStr | None) -> bool:
    return value is not None and bool(value.get_secret_value().strip())


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
