"""Workspace retrieval/ingestion settings and the (environment-configured) model settings."""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlparse

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from rackflow.audit import record_audit
from rackflow.auth.deps import require
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.config import get_settings
from rackflow.core.errors import ValidationFailedError
from rackflow.db.models import TenantSettings
from rackflow.db.session import get_db
from rackflow.providers.chat import get_chat_provider
from rackflow.tenant_settings import effective_settings

router = APIRouter(prefix="/settings", tags=["settings"])

_FIELDS = ("retrieval_top_k", "retrieval_score_threshold", "chunk_size_tokens",
           "chunk_overlap_tokens", "ocr_enabled", "max_storage_bytes")


class TenantSettingsValues(BaseModel):
    retrieval_top_k: int | None = Field(default=None, ge=1, le=50)
    retrieval_score_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    chunk_size_tokens: int | None = Field(default=None, ge=50, le=2000)
    chunk_overlap_tokens: int | None = Field(default=None, ge=0, le=500)
    ocr_enabled: bool | None = None
    max_storage_bytes: int | None = Field(default=None, ge=1_048_576)


class TenantSettingsOut(BaseModel):
    effective: TenantSettingsValues
    overrides: TenantSettingsValues  # null = inherits the deployment default
    updated_at: datetime | None
    note: str = "Chunking changes apply to documents processed after the change."


class ModelSettingsOut(BaseModel):
    provider: str
    model: str
    deployment_mode: str
    endpoint_host: str | None
    timeout_seconds: float
    max_concurrency: int
    configured_via: str = "environment"


def _out(db: Session, principal: Principal) -> TenantSettingsOut:
    eff = effective_settings(db, principal.tenant_id)
    row = db.get(TenantSettings, principal.tenant_id)
    return TenantSettingsOut(
        effective=TenantSettingsValues(**{f: getattr(eff, f) for f in _FIELDS}),
        overrides=TenantSettingsValues(**{f: getattr(row, f, None) for f in _FIELDS}),
        updated_at=row.updated_at if row else None,
    )


@router.get("/tenant", response_model=TenantSettingsOut)
def get_tenant_settings(
    principal: Principal = Depends(require(Permission.SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> TenantSettingsOut:
    return _out(db, principal)


@router.patch("/tenant", response_model=TenantSettingsOut)
def update_tenant_settings(
    body: TenantSettingsValues,
    principal: Principal = Depends(require(Permission.SETTINGS_MANAGE)),
    db: Session = Depends(get_db),
) -> TenantSettingsOut:
    row = db.get(TenantSettings, principal.tenant_id) or TenantSettings(
        tenant_id=principal.tenant_id)
    changed = sorted(body.model_fields_set)
    for field in changed:  # explicit null resets a field to the deployment default
        setattr(row, field, getattr(body, field))
    env = get_settings()
    size = row.chunk_size_tokens or env.chunk_size_tokens
    overlap = row.chunk_overlap_tokens if row.chunk_overlap_tokens is not None \
        else env.chunk_overlap_tokens
    if overlap >= size:
        raise ValidationFailedError(code="INVALID_CHUNKING",
                                    message="Chunk overlap must be smaller than chunk size.")
    row.updated_at = datetime.now(UTC)
    row.updated_by = principal.user_id
    db.add(row)
    record_audit(db, action="settings.update", resource_type="tenant_settings",
                 resource_id=principal.tenant_id, principal=principal,
                 metadata={"fields": changed})
    db.commit()
    return _out(db, principal)


@router.get("/model", response_model=ModelSettingsOut)
def get_model_settings(_: Principal = Depends(require(Permission.MODEL_READ))) -> ModelSettingsOut:
    """Read-only: the model is configured by deployment environment so secrets never pass
    through the API (API_SPEC's PATCH /settings/model is deferred — see DECISIONS ADR-019)."""
    settings = get_settings()
    provider = get_chat_provider()
    host = urlparse(settings.model_base_url).hostname if settings.model_base_url else None
    return ModelSettingsOut(provider=provider.provider, model=provider.model,
                            deployment_mode=provider.deployment_mode, endpoint_host=host,
                            timeout_seconds=settings.model_timeout_seconds,
                            max_concurrency=settings.model_max_concurrency)
