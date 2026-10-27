"""Effective per-tenant settings: TenantSettings overrides on top of environment defaults."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from rackflow.core.config import get_settings
from rackflow.db.models import TenantSettings


@dataclass(frozen=True, slots=True)
class EffectiveSettings:
    retrieval_top_k: int
    retrieval_score_threshold: float
    chunk_size_tokens: int
    chunk_overlap_tokens: int
    ocr_enabled: bool
    max_storage_bytes: int | None
    upload_max_bytes: int
    upload_max_pages: int


def effective_settings(db: Session, tenant_id: uuid.UUID) -> EffectiveSettings:
    env = get_settings()
    row = db.get(TenantSettings, tenant_id)

    def pick(name: str, default: Any) -> Any:
        value = getattr(row, name, None) if row is not None else None
        return default if value is None else value

    return EffectiveSettings(
        retrieval_top_k=pick("retrieval_top_k", env.retrieval_top_k),
        retrieval_score_threshold=pick("retrieval_score_threshold", env.retrieval_score_threshold),
        chunk_size_tokens=pick("chunk_size_tokens", env.chunk_size_tokens),
        chunk_overlap_tokens=pick("chunk_overlap_tokens", env.chunk_overlap_tokens),
        ocr_enabled=pick("ocr_enabled", env.ocr_enabled),
        max_storage_bytes=pick("max_storage_bytes", None),
        upload_max_bytes=env.upload_max_bytes,
        upload_max_pages=env.upload_max_pages,
    )
