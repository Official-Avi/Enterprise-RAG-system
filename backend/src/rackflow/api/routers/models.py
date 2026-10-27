"""Model serving status, health and request metrics (FR-050..FR-053). Never exposes secrets."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.auth.deps import require
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.config import get_settings
from rackflow.db.models import ModelRequestLog
from rackflow.db.session import get_db
from rackflow.providers.chat import get_chat_provider

router = APIRouter(prefix="/models", tags=["models"])
WINDOWS = {"1h": 3600, "24h": 86400, "7d": 604800}


class ModelInfo(BaseModel):
    provider: str
    name: str
    deployment_mode: str
    is_default: bool
    timeout_seconds: float
    max_concurrency: int


class ModelList(BaseModel):
    items: list[ModelInfo]


class HealthOut(BaseModel):
    ok: bool
    provider: str
    model: str
    deployment_mode: str
    detail: str
    latency_ms: int | None


class ModelMetrics(BaseModel):
    window_seconds: int
    requests: int
    errors: int
    timeouts: int
    error_rate: float | None
    avg_latency_ms: int | None
    p95_latency_ms: int | None
    prompt_tokens: int
    completion_tokens: int


@router.get("", response_model=ModelList)
def list_models(_: Principal = Depends(require(Permission.MODEL_READ))) -> ModelList:
    provider = get_chat_provider()
    settings = get_settings()
    return ModelList(items=[ModelInfo(
        provider=provider.provider, name=provider.model, deployment_mode=provider.deployment_mode,
        is_default=True, timeout_seconds=settings.model_timeout_seconds,
        max_concurrency=settings.model_max_concurrency,
    )])


@router.get("/health", response_model=HealthOut)
def model_health(_: Principal = Depends(require(Permission.MODEL_READ))) -> HealthOut:
    h = get_chat_provider().health()
    return HealthOut(ok=h.ok, provider=h.provider, model=h.model,
                     deployment_mode=h.deployment_mode, detail=h.detail, latency_ms=h.latency_ms)


@router.get("/metrics", response_model=ModelMetrics)
def model_metrics(
    window: Literal["1h", "24h", "7d"] = "1h",
    principal: Principal = Depends(require(Permission.MODEL_READ)),
    db: Session = Depends(get_db),
) -> ModelMetrics:
    seconds = WINDOWS[window]
    rows = db.execute(select(ModelRequestLog.status, ModelRequestLog.latency_ms,
                             ModelRequestLog.prompt_tokens, ModelRequestLog.completion_tokens)
                      .where(ModelRequestLog.tenant_id == principal.tenant_id,
                             ModelRequestLog.created_at >= datetime.now(UTC)
                             - timedelta(seconds=seconds))).all()
    latencies = sorted(r.latency_ms for r in rows if r.status == "ok")
    errors = sum(1 for r in rows if r.status != "ok")
    return ModelMetrics(
        window_seconds=seconds,
        requests=len(rows),
        errors=errors,
        timeouts=sum(1 for r in rows if r.status == "timeout"),
        error_rate=round(errors / len(rows), 4) if rows else None,
        avg_latency_ms=int(sum(latencies) / len(latencies)) if latencies else None,
        p95_latency_ms=latencies[min(len(latencies) - 1, int(0.95 * len(latencies)))]
        if latencies else None,
        prompt_tokens=sum(r.prompt_tokens or 0 for r in rows),
        completion_tokens=sum(r.completion_tokens or 0 for r in rows),
    )
