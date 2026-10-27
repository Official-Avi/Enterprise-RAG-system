"""Evaluation datasets and runs (FR-063). Runs execute as queued jobs with the permissions of
the user who started them; per-question answers are shown only to content-capable roles."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from rackflow.audit import record_audit
from rackflow.auth.deps import require
from rackflow.auth.principal import Principal
from rackflow.auth.rbac import Permission
from rackflow.core.errors import NotFoundError
from rackflow.db.models import EvaluationRun, JobType, User
from rackflow.db.session import get_db
from rackflow.evaluation.dataset import Dataset, available_versions, load_dataset
from rackflow.evaluation.seed import seed_dataset
from rackflow.jobs.enqueue import enqueue_job
from rackflow.providers.chat import get_chat_provider
from rackflow.rag.retrieval import authorized_collections

router = APIRouter(prefix="/evaluation", tags=["evaluation"])


class DatasetOut(BaseModel):
    version: str
    description: str
    questions: int
    categories: dict[str, int]


class SeedOut(BaseModel):
    main_collection_id: uuid.UUID
    restricted_collection_id: uuid.UUID
    queued: int
    duplicates: int
    rejected: list[str]


class RunIn(BaseModel):
    dataset_version: str = Field(default="v1", max_length=16)
    collection_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)


class RunOut(BaseModel):
    id: uuid.UUID
    dataset_version: str
    status: str
    model: dict[str, Any]
    collection_ids: list[str]
    metrics: dict[str, Any]
    created_by_email: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    job_id: uuid.UUID | None


class RunDetail(RunOut):
    results: list[dict[str, Any]]


def _dataset(version: str) -> Dataset:
    try:
        return load_dataset(version)
    except KeyError as exc:
        raise NotFoundError(code="DATASET_NOT_FOUND", message="Unknown dataset version.") from exc


def _out(run: EvaluationRun, email: str | None) -> RunOut:
    cfg = dict(run.model_config or {})
    return RunOut(id=run.id, dataset_version=run.dataset_version, status=run.status,
                  model={k: v for k, v in cfg.items() if k != "collection_ids"},
                  collection_ids=list(cfg.get("collection_ids", [])),
                  metrics=dict(run.metrics or {}), created_by_email=email,
                  created_at=run.created_at, started_at=run.started_at,
                  finished_at=run.finished_at, job_id=run.job_id)


@router.get("/datasets", response_model=list[DatasetOut])
def list_datasets(_: Principal = Depends(require(Permission.EVAL_READ))) -> list[DatasetOut]:
    out = []
    for version in available_versions():
        ds = load_dataset(version)
        categories: dict[str, int] = {}
        for q in ds.questions:
            categories[q.category] = categories.get(q.category, 0) + 1
        out.append(DatasetOut(version=version, description=ds.description,
                              questions=len(ds.questions), categories=categories))
    return out


@router.post("/datasets/{version}/seed", response_model=SeedOut)
def seed(
    version: str,
    principal: Principal = Depends(require(Permission.EVAL_RUN, Permission.COLLECTION_CREATE)),
    db: Session = Depends(get_db),
) -> SeedOut:
    """Create the evaluation collections and queue the corpus for ingestion (idempotent)."""
    result = seed_dataset(db, _dataset(version), tenant_id=principal.tenant_id,
                          user_id=principal.user_id)
    record_audit(db, action="evaluation.seed", resource_type="dataset", resource_id=version,
                 principal=principal, metadata={"queued": result.queued})
    db.commit()
    return SeedOut(main_collection_id=result.main_collection_id,
                   restricted_collection_id=result.restricted_collection_id,
                   queued=result.queued, duplicates=result.duplicates, rejected=result.rejected)


@router.post("/runs", response_model=RunOut, status_code=202)
def create_run(
    body: RunIn,
    principal: Principal = Depends(require(Permission.EVAL_RUN)),
    db: Session = Depends(get_db),
) -> RunOut:
    _dataset(body.dataset_version)
    requested = list(dict.fromkeys(body.collection_ids))
    if len(authorized_collections(db, principal, requested)) != len(requested):
        raise NotFoundError(code="COLLECTION_NOT_FOUND",
                            message="The requested collection could not be found.")
    provider = get_chat_provider()
    run = EvaluationRun(
        tenant_id=principal.tenant_id, dataset_version=body.dataset_version, status="queued",
        model_config={"provider": provider.provider, "model": provider.model,
                      "deployment_mode": provider.deployment_mode,
                      "collection_ids": [str(c) for c in requested]},
        metrics={}, results=[], created_by=principal.user_id, created_at=datetime.now(UTC))
    db.add(run)
    db.flush()
    job = enqueue_job(db, tenant_id=principal.tenant_id, job_type=JobType.EVALUATION_RUN,
                      idempotency_key=f"evaluation:{run.id}", payload={"run_id": str(run.id)},
                      created_by=principal.user_id, max_attempts=2)
    run.job_id = job.id
    record_audit(db, action="evaluation.run", resource_type="evaluation_run", resource_id=run.id,
                 principal=principal, metadata={"dataset": body.dataset_version})
    db.commit()
    return _out(run, principal.email)


@router.get("/runs", response_model=list[RunOut])
def list_runs(
    limit: int = Query(default=20, ge=1, le=100),
    principal: Principal = Depends(require(Permission.EVAL_READ)),
    db: Session = Depends(get_db),
) -> list[RunOut]:
    rows = db.execute(select(EvaluationRun, User.email)
                      .outerjoin(User, User.id == EvaluationRun.created_by)
                      .where(EvaluationRun.tenant_id == principal.tenant_id)
                      .order_by(EvaluationRun.created_at.desc()).limit(limit)).all()
    return [_out(run, email) for run, email in rows]


@router.get("/runs/{run_id}", response_model=RunDetail)
def get_run(
    run_id: uuid.UUID,
    principal: Principal = Depends(require(Permission.EVAL_READ)),
    db: Session = Depends(get_db),
) -> RunDetail:
    row = db.execute(select(EvaluationRun, User.email)
                     .outerjoin(User, User.id == EvaluationRun.created_by)
                     .where(EvaluationRun.id == run_id,
                            EvaluationRun.tenant_id == principal.tenant_id)).first()
    if row is None:
        raise NotFoundError(code="RUN_NOT_FOUND",
                            message="The evaluation run could not be found.")
    run, email = row
    results = list(run.results or [])
    if not principal.can(Permission.DOCUMENT_READ_CONTENT):  # auditors: scores, not content
        results = [{k: v for k, v in r.items() if k not in ("question", "answer")}
                   for r in results]
    return RunDetail(**_out(run, email).model_dump(), results=results)
