"""Relational schema (see Docs/DATA_MODEL.md). Every tenant-owned row carries `tenant_id`.

Authorization is never inferred from IDs: every query on tenant-owned tables must filter by the
caller's tenant (and collection permissions where content is involved).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from rackflow.db.base import Base, CreatedAt, Timestamps, UUIDPk


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(
        cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=32,
        values_callable=lambda e: [m.value for m in e],
    )


# ---------------------------------------------------------------------------- enums


class Role(enum.StrEnum):
    ORG_ADMIN = "org_admin"
    OPERATOR = "operator"
    ENGINEER = "engineer"
    AUDITOR = "auditor"


class CollectionVisibility(enum.StrEnum):
    TENANT = "tenant"  # every content-capable member of the tenant may read
    RESTRICTED = "restricted"  # only org_admin and explicit grants may read


class CollectionPermissionLevel(enum.StrEnum):
    READ = "read"
    WRITE = "write"  # upload / reprocess / delete own documents
    MANAGE = "manage"  # edit collection, grant access, delete any document


class DocumentStatus(enum.StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    INDEXED = "indexed"
    FAILED = "failed"
    DELETING = "deleting"
    DELETED = "deleted"


class JobStatus(enum.StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    RETRY_WAIT = "retry_wait"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL_JOB_STATUSES = frozenset({JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED})


class JobType(enum.StrEnum):
    INGEST_DOCUMENT = "ingest_document"
    DELETE_DOCUMENT = "delete_document"
    EVALUATION_RUN = "evaluation_run"


class PipelineStage(enum.StrEnum):
    VALIDATE = "validate"
    EXTRACT = "extract"
    OCR = "ocr"
    QUALITY_CHECK = "quality_check"
    CLEAN = "clean"
    CHUNK = "chunk"
    EMBED = "embed"
    INDEX = "index"
    FINALIZE = "finalize"
    DELETE_VECTORS = "delete_vectors"
    DELETE_OBJECTS = "delete_objects"
    DELETE_ROWS = "delete_rows"


class StageStatus(enum.StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


class EvidenceStatus(enum.StrEnum):
    SUPPORTED = "supported"
    INSUFFICIENT = "insufficient"


class StateSource(enum.StrEnum):
    MANUAL = "manual"
    SIMULATED = "simulated"
    INTEGRATION = "integration"


# --------------------------------------------------------------- identity / tenancy


class Tenant(UUIDPk, CreatedAt, Base):
    __tablename__ = "tenants"
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    status: Mapped[str] = mapped_column(String(32), default="active")


class User(UUIDPk, CreatedAt, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(320), unique=True)  # stored lower-cased
    display_name: Mapped[str] = mapped_column(String(200))
    auth_subject: Mapped[str | None] = mapped_column(String(255), unique=True)  # future OIDC
    password_hash: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(32), default="active")  # active | disabled


class TenantMembership(UUIDPk, CreatedAt, Base):
    __tablename__ = "tenant_memberships"
    __table_args__ = (UniqueConstraint("tenant_id", "user_id", name="uq_membership_tenant_user"),)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[Role] = mapped_column(_enum(Role, "role"))


class AuthSession(UUIDPk, CreatedAt, Base):
    """Server-side session. Only a SHA-256 hash of the random token is stored."""

    __tablename__ = "auth_sessions"
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TenantSettings(Base):
    """Per-tenant overrides for ingestion and retrieval (falls back to env defaults when null)."""

    __tablename__ = "tenant_settings"
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), primary_key=True
    )
    retrieval_top_k: Mapped[int | None] = mapped_column(Integer)
    retrieval_score_threshold: Mapped[float | None] = mapped_column(Float)
    chunk_size_tokens: Mapped[int | None] = mapped_column(Integer)
    chunk_overlap_tokens: Mapped[int | None] = mapped_column(Integer)
    ocr_enabled: Mapped[bool | None] = mapped_column(Boolean)
    max_storage_bytes: Mapped[int | None] = mapped_column(BigInteger)  # tenant quota
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


# ---------------------------------------------------------------- knowledge base


class Collection(UUIDPk, Timestamps, Base):
    __tablename__ = "collections"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_collection_tenant_name"),)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    visibility: Mapped[CollectionVisibility] = mapped_column(
        _enum(CollectionVisibility, "collection_visibility"), default=CollectionVisibility.TENANT
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class CollectionPermission(UUIDPk, CreatedAt, Base):
    __tablename__ = "collection_permissions"
    __table_args__ = (
        UniqueConstraint(
            "collection_id", "principal_type", "principal_id", name="uq_collection_principal"
        ),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    collection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE")
    )
    principal_type: Mapped[str] = mapped_column(String(16))  # "user" (roles via Role matrix)
    principal_id: Mapped[uuid.UUID] = mapped_column(Uuid)
    permission: Mapped[CollectionPermissionLevel] = mapped_column(
        _enum(CollectionPermissionLevel, "collection_permission_level")
    )


class Document(UUIDPk, Timestamps, Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_tenant_created", "tenant_id", "created_at"),
        Index("ix_documents_collection_status", "collection_id", "status"),
        # Deduplication: one live document per content hash within a collection.
        Index(
            "uq_documents_live_hash",
            "tenant_id",
            "collection_id",
            "content_hash",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    collection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE")
    )
    filename: Mapped[str] = mapped_column(String(255))  # sanitised display name, never a path
    file_type: Mapped[str] = mapped_column(String(16))  # pdf | docx | txt | md
    mime_type: Mapped[str] = mapped_column(String(127))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    content_hash: Mapped[str] = mapped_column(String(64))  # sha256 hex
    storage_key: Mapped[str] = mapped_column(String(512))  # generated, tenant-scoped
    status: Mapped[DocumentStatus] = mapped_column(
        _enum(DocumentStatus, "document_status"), default=DocumentStatus.QUEUED
    )
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    page_count: Mapped[int | None] = mapped_column(Integer)
    extracted_chars: Mapped[int | None] = mapped_column(Integer)
    chunk_count: Mapped[int | None] = mapped_column(Integer)
    token_count: Mapped[int | None] = mapped_column(Integer)
    extraction_method: Mapped[str | None] = mapped_column(String(32))  # text | ocr | mixed
    ocr_page_count: Mapped[int | None] = mapped_column(Integer)
    quality_score: Mapped[float | None] = mapped_column(Float)
    warnings: Mapped[list[str]] = mapped_column(JSONB, default=list)
    pipeline_version: Mapped[str | None] = mapped_column(String(32))
    embedding_model: Mapped[str | None] = mapped_column(String(128))
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DocumentVersion(UUIDPk, CreatedAt, Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version", name="uq_docversion_doc_ver"),)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    pipeline_version: Mapped[str] = mapped_column(String(32))
    embedding_model: Mapped[str | None] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(32), default="processing")


class Chunk(UUIDPk, CreatedAt, Base):
    """Chunk text is stored for citation display; access is re-authorised on every read."""

    __tablename__ = "chunks"
    __table_args__ = (
        UniqueConstraint("document_version_id", "chunk_index", name="uq_chunk_version_index"),
        Index("ix_chunks_tenant_collection", "tenant_id", "collection_id"),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    collection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE")
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    document_version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("document_versions.id", ondelete="CASCADE")
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    token_count: Mapped[int] = mapped_column(Integer)
    char_start: Mapped[int | None] = mapped_column(Integer)
    char_end: Mapped[int | None] = mapped_column(Integer)
    page_start: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


# ------------------------------------------------------------------- jobs / workers


class ProcessingJob(UUIDPk, Timestamps, Base):
    """Authoritative job state. The PostgreSQL queue claims rows with SKIP LOCKED + leases."""

    __tablename__ = "processing_jobs"
    __table_args__ = (
        Index("ix_jobs_claim", "status", "available_at", "priority"),
        Index("ix_jobs_tenant_status_time", "tenant_id", "status", "queued_at"),
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), index=True
    )
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("collections.id", ondelete="SET NULL")
    )
    job_type: Mapped[JobType] = mapped_column(_enum(JobType, "job_type"))
    status: Mapped[JobStatus] = mapped_column(_enum(JobStatus, "job_status"))
    stage: Mapped[str | None] = mapped_column(String(32))
    priority: Mapped[int] = mapped_column(Integer, default=100)  # lower runs first
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=4)
    idempotency_key: Mapped[str] = mapped_column(String(200), unique=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)  # IDs only, no content
    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_owner: Mapped[str | None] = mapped_column(String(128))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    error_code: Mapped[str | None] = mapped_column(String(64))
    safe_error_message: Mapped[str | None] = mapped_column(String(500))
    correlation_id: Mapped[str | None] = mapped_column(String(64))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class JobAttempt(UUIDPk, Base):
    __tablename__ = "job_attempts"
    __table_args__ = (UniqueConstraint("job_id", "attempt_number", name="uq_attempt_job_number"),)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("processing_jobs.id", ondelete="CASCADE"), index=True
    )
    attempt_number: Mapped[int] = mapped_column(Integer)
    worker_id: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(32))  # running | succeeded | failed | abandoned
    stage: Mapped[str | None] = mapped_column(String(32))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(64))
    safe_error_message: Mapped[str | None] = mapped_column(String(500))


class PipelineStageRun(UUIDPk, Base):
    """Per-stage history for a job attempt (FR-021). Details hold counts only, never text."""

    __tablename__ = "pipeline_stage_runs"
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    job_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("processing_jobs.id", ondelete="CASCADE"), index=True
    )
    attempt_number: Mapped[int] = mapped_column(Integer)
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL")
    )
    stage: Mapped[PipelineStage] = mapped_column(_enum(PipelineStage, "pipeline_stage"))
    status: Mapped[StageStatus] = mapped_column(_enum(StageStatus, "stage_status"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    error_code: Mapped[str | None] = mapped_column(String(64))


class WorkerHeartbeat(Base):
    __tablename__ = "worker_heartbeats"
    worker_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    hostname: Mapped[str] = mapped_column(String(255))
    pid: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32))  # idle | busy | stopping | stopped
    current_job_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    jobs_succeeded: Mapped[int] = mapped_column(Integer, default=0)
    jobs_failed: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    version: Mapped[str] = mapped_column(String(32))
    capabilities: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


# -------------------------------------------------------------------------- chat


class Conversation(UUIDPk, Timestamps, Base):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_tenant_user", "tenant_id", "user_id"),)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200), default="New conversation")
    collection_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)


class ChatMessage(UUIDPk, CreatedAt, Base):
    __tablename__ = "chat_messages"
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    evidence_status: Mapped[EvidenceStatus | None] = mapped_column(
        _enum(EvidenceStatus, "evidence_status")
    )
    model_provider: Mapped[str | None] = mapped_column(String(64))
    model_name: Mapped[str | None] = mapped_column(String(128))
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    retrieval_stats: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class Citation(UUIDPk, CreatedAt, Base):
    __tablename__ = "citations"
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_messages.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL")
    )
    chunk_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("chunks.id", ondelete="SET NULL"))
    marker: Mapped[int] = mapped_column(Integer)  # [n] marker used in the answer text
    page: Mapped[int | None] = mapped_column(Integer)
    quote: Mapped[str] = mapped_column(String(600))
    rank_score: Mapped[float | None] = mapped_column(Float)


# ------------------------------------------------------------------ model serving


class ModelEndpoint(UUIDPk, Timestamps, Base):
    """Model configuration. Secrets are never stored: `api_key_env` names an env variable."""

    __tablename__ = "model_endpoints"
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(120))
    provider: Mapped[str] = mapped_column(String(64))
    model_id: Mapped[str] = mapped_column(String(200))
    base_url: Mapped[str | None] = mapped_column(String(500))
    api_key_env: Mapped[str | None] = mapped_column(String(120))
    deployment_mode: Mapped[str] = mapped_column(String(16), default="remote")  # local | remote
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    timeout_seconds: Mapped[float] = mapped_column(Float, default=60.0)
    max_concurrency: Mapped[int] = mapped_column(Integer, default=4)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class ModelRequestLog(UUIDPk, CreatedAt, Base):
    """Per-inference metrics (no prompt or answer text)."""

    __tablename__ = "model_request_logs"
    __table_args__ = (Index("ix_model_requests_tenant_time", "tenant_id", "created_at"),)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE")
    )
    provider: Mapped[str] = mapped_column(String(64))
    model_name: Mapped[str] = mapped_column(String(200))
    purpose: Mapped[str] = mapped_column(String(32))  # chat | evaluation | health
    status: Mapped[str] = mapped_column(String(16))  # ok | error | timeout | rejected
    latency_ms: Mapped[int] = mapped_column(Integer)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    error_code: Mapped[str | None] = mapped_column(String(64))
    correlation_id: Mapped[str | None] = mapped_column(String(64))


# ---------------------------------------------------------------------- evaluation


class EvaluationRun(UUIDPk, Base):
    __tablename__ = "evaluation_runs"
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    dataset_version: Mapped[str] = mapped_column(String(64))
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("collections.id", ondelete="SET NULL")
    )
    model_config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(32), default="queued")
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    results: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    job_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("processing_jobs.id", ondelete="SET NULL")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ------------------------------------------------------- logical infrastructure


class Rack(UUIDPk, Timestamps, Base):
    __tablename__ = "racks"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_rack_tenant_name"),)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    environment: Mapped[str] = mapped_column(String(32))  # dev | staging | production
    location_label: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    rack_units: Mapped[int | None] = mapped_column(Integer)
    state_source: Mapped[StateSource] = mapped_column(_enum(StateSource, "state_source"))
    status: Mapped[str] = mapped_column(String(32), default="unknown")
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class NodeResource(UUIDPk, Timestamps, Base):
    __tablename__ = "node_resources"
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    rack_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("racks.id", ondelete="SET NULL"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    resource_type: Mapped[str] = mapped_column(String(32))  # server | gpu_node | storage | vm
    rack_unit_position: Mapped[int | None] = mapped_column(Integer)
    cpu_cores: Mapped[int | None] = mapped_column(Integer)
    memory_bytes: Mapped[int | None] = mapped_column(BigInteger)
    accelerator_info: Mapped[str | None] = mapped_column(String(200))
    storage_bytes: Mapped[int | None] = mapped_column(BigInteger)
    state_source: Mapped[StateSource] = mapped_column(_enum(StateSource, "state_source"))
    status: Mapped[str] = mapped_column(String(32), default="unknown")
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)


class Workload(UUIDPk, Timestamps, Base):
    """Logical workload registration. Never deploys or controls real infrastructure."""

    __tablename__ = "workloads"
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    workload_type: Mapped[str] = mapped_column(String(32))  # api | worker | vector_db | ...
    node_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("node_resources.id", ondelete="SET NULL"), index=True
    )
    desired_state: Mapped[str] = mapped_column(String(32), default="running")
    observed_state: Mapped[str] = mapped_column(String(32), default="unknown")
    resource_request: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    resource_assignment: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    state_source: Mapped[StateSource] = mapped_column(_enum(StateSource, "state_source"))


# --------------------------------------------------------------------------- audit


class AuditEvent(UUIDPk, CreatedAt, Base):
    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_tenant_time", "tenant_id", "created_at"),)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE")
    )
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(64))
    resource_type: Mapped[str] = mapped_column(String(64))
    resource_id: Mapped[str | None] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(16))  # success | denied | failure
    correlation_id: Mapped[str | None] = mapped_column(String(64))
    safe_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
