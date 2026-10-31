"""Typed application configuration loaded from environment variables (and `.env` in development).

Validation happens at startup so a misconfigured deployment fails fast with an actionable,
secret-free message instead of failing later on a request path.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
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
        if self.app_env == "production":
            if not self.cookie_secure:
                raise ValueError("COOKIE_SECURE must be true in production")
            if self.embedding_provider == "hash":
                raise ValueError("EMBEDDING_PROVIDER=hash is a test-only provider")
            if self.demo_mode:
                raise ValueError("DEMO_MODE must be false in production")
        return self

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.web_origin.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
