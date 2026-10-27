# Data Model — Initial Logical Schema

Use UUID primary keys, UTC timestamps, migrations, foreign keys, indexes, and tenant scoping. Exact ORM syntax is implementation-dependent.

## Core entities
- `Tenant`: id, name, slug, status, created_at.
- `User`: id, email, display_name, auth_subject, status, created_at.
- `TenantMembership`: id, tenant_id, user_id, role, created_at.
- `Collection`: id, tenant_id, name, description, created_by, created_at.
- `CollectionPermission`: id, tenant_id, collection_id, principal_type, principal_id, permission.
- `Document`: id, tenant_id, collection_id, filename, mime_type, size_bytes, content_hash, storage_key, status, page_count, extracted_chars, pipeline_version, uploaded_by, created_at, updated_at.
- `DocumentVersion`: id, tenant_id, document_id, version, content_hash, pipeline_version, status, created_at.
- `Chunk`: id, tenant_id, collection_id, document_id, document_version_id, chunk_index, text_ref or text, token_count, page_start, page_end, metadata_json, created_at.
- `ProcessingJob`: id, tenant_id, document_id, job_type, status, stage, attempt_count, max_attempts, idempotency_key, queued_at, started_at, finished_at, error_code, safe_error_message, correlation_id.
- `JobAttempt`: id, tenant_id, job_id, attempt_number, worker_id, started_at, finished_at, status, error_code, safe_error_message.
- `Conversation`: id, tenant_id, user_id, title, created_at, updated_at.
- `ChatMessage`: id, tenant_id, conversation_id, role, content, evidence_status, model_provider, model_name, latency_ms, created_at.
- `Citation`: id, tenant_id, message_id, document_id, chunk_id, page, quote_ref, rank_score.
- `ModelEndpoint`: id, tenant_id nullable for platform-level, name, provider, model_id, endpoint_ref, enabled, config_json, created_at.
- `EvaluationRun`: id, tenant_id, dataset_version, model_config, status, metrics_json, started_at, finished_at.
- `Rack`: id, tenant_id, name, environment, description, state_source, status, metadata_json, created_at, updated_at.
- `NodeResource`: id, tenant_id, rack_id, name, resource_type, cpu_cores, memory_bytes, accelerator_info, storage_bytes, state_source, status, last_seen_at.
- `Workload`: id, tenant_id, name, workload_type, desired_state, observed_state, resource_request_json, resource_assignment_json, state_source, created_at, updated_at.
- `AuditEvent`: id, tenant_id, actor_user_id, action, resource_type, resource_id, outcome, correlation_id, safe_metadata_json, created_at.

## Important constraints
- Add indexes on `(tenant_id, created_at)`, status/time for jobs, content hash within tenant/collection, and foreign-key columns.
- Use unique membership constraint `(tenant_id, user_id)`.
- Use tenant-aware uniqueness for collection names/slugs as needed.
- Keep vector IDs mapped to chunk/document/version IDs. Store vector-store collection/namespace and embedding model version in config/metadata.
- Avoid duplicating full sensitive text into audit logs.
- Prefer object storage for original files and large extraction artifacts; if chunk text is stored in DB, encrypt at rest according to deployment requirements and enforce authorization.
- Deletion must propagate to object storage, relational rows, and vector store. Use a retryable deletion job for cross-system cleanup.
- Never assume UUIDs themselves provide authorization.
