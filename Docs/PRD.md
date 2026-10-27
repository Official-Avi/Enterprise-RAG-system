# Product Requirements Document (PRD)
## RackFlow AI

## 1. Product summary
RackFlow AI is a web control plane for document-grounded AI knowledge workflows and the workloads supporting them. Users upload documents, the platform processes and indexes them, then users ask questions and receive answers with source references. Operators manage processing queues, workers, model endpoints, logical rack inventory, and platform health.

## 2. MVP user journeys

### Journey A — Add knowledge
1. An authorized user creates or selects a knowledge collection.
2. The user uploads one or more supported files.
3. The API checks file size, extension, MIME type, and tenant permission.
4. Files are stored and jobs are queued.
5. Workers extract text; scanned PDFs can go through OCR if enabled.
6. The pipeline validates extraction quality, cleans text, tokenizes/counts, chunks, embeds, and indexes.
7. The UI displays per-file state, progress, warnings, and retry action when allowed.

### Journey B — Ask a grounded question
1. A user submits a question inside a collection they can access.
2. The backend authenticates the user and applies tenant/collection/document permissions.
3. The retrieval layer searches only authorized indexed chunks.
4. Optional reranking improves ordering when configured.
5. Context assembly respects model token limits and includes source metadata.
6. The model generates a grounded answer; the response includes citations to source documents and page/chunk locations when available.
7. If evidence is insufficient, the assistant must say so instead of inventing an answer.

### Journey C — Operate processing
1. An operator opens the Operations dashboard.
2. The dashboard shows queued, running, completed, failed, and retrying jobs.
3. The operator filters by tenant, collection, job type, time, and status, subject to permissions.
4. The operator opens a failed job to inspect a safe error summary and correlation ID.
5. The operator retries a retryable job or cancels a queued job if permitted.
6. Worker health, queue depth, throughput, and processing latency help identify bottlenecks.

### Journey D — Manage logical racks/resources
1. An operator opens Infrastructure.
2. The UI shows registered logical racks, nodes/resources, assigned workloads, health state, capacity estimates, and last update.
3. Resource status must be labelled as configured, simulated, or integration-reported.
4. In MVP, rack data can be seeded or manually registered; do not imply live hardware telemetry without an integration.

### Journey E — Administer access
1. An organization admin invites or creates users.
2. Admin assigns roles and collection permissions.
3. API checks permissions on every protected action.
4. Retrieval filters by permissions before chunks reach the model.
5. Audit events record key access and configuration changes without logging secrets or full sensitive document content.

## 3. Functional requirements

### Identity and tenancy
- FR-001: Users must authenticate before accessing protected workspace data.
- FR-002: Every tenant-owned record must be scoped to an organization/tenant.
- FR-003: Tenant context must be derived from verified identity, not trusted from arbitrary request body fields.
- FR-004: Roles: `org_admin`, `operator`, `engineer`, `auditor`; permissions must be explicit and tested.
- FR-005: Denied access must not reveal whether another tenant's documents exist.

### Documents and ingestion
- FR-010: Upload multiple files with progress and clear validation errors.
- FR-011: Support PDF, TXT, Markdown, DOCX initially; add CSV/HTML only after safe parsing tests.
- FR-012: Enforce file size, MIME sniffing, extension allowlist, upload limits, and tenant quotas.
- FR-013: Detect duplicates using content hash within a tenant/collection; allow policy-controlled reprocessing.
- FR-014: Detect corrupt, empty, or unsupported files and record actionable status.
- FR-015: Extract selectable PDF text; run OCR only for image/scanned pages when configured.
- FR-016: Record extraction method, page count, text length, OCR warnings, and pipeline version.
- FR-017: Clean text conservatively; preserve meaningful punctuation, code blocks, tables where possible, and source positions.
- FR-018: Count tokens using the selected model/tokenizer where possible.
- FR-019: Chunk documents with configurable chunk size and overlap; preserve document/page/source metadata.
- FR-020: Generate embeddings through a provider interface and store vectors in a vector-store adapter.
- FR-021: Each processing stage must have explicit state, timestamps, retries, and error details safe for the UI.
- FR-022: Deleting a document must also remove its chunks/vectors and handle queued jobs safely.

### Retrieval and chat
- FR-030: Search must be scoped to tenant and authorized collections/documents.
- FR-031: Provide configurable top-k retrieval and similarity threshold.
- FR-032: Keep retrieval, optional hybrid search, and optional reranking behind interfaces.
- FR-033: Responses must include citations to retrieved sources where supported.
- FR-034: If no sufficient evidence is found, return a clear uncertainty/insufficient-evidence response.
- FR-035: Store conversation history with tenant/user ownership and configurable retention.
- FR-036: Do not treat document text as system instructions; mitigate prompt injection from retrieved content.
- FR-037: Display retrieved source snippets only when the user has permission to see the source.

### Workload management
- FR-040: Use a durable job queue for long-running processing.
- FR-041: Job states: `queued`, `running`, `succeeded`, `failed`, `retry_wait`, `cancelled`.
- FR-042: Use bounded retries with exponential backoff and jitter; record attempt count.
- FR-043: Use idempotency keys or deterministic stage identifiers to avoid duplicate writes.
- FR-044: A worker crash must not silently mark an incomplete job as succeeded.
- FR-045: Provide safe cancellation for queued jobs; running-job cancellation is best-effort and stage-aware.
- FR-046: Separate queue routing or priorities by job type only when needed; avoid starvation.
- FR-047: Support increasing worker replicas horizontally, subject to CPU/RAM/GPU and downstream limits.

### Model serving
- FR-050: Expose a single internal inference interface to the application.
- FR-051: Support configurable model providers/endpoints; do not hardcode one model.
- FR-052: Track request latency, timeout, provider errors, token usage if available, and model identifier.
- FR-053: Apply request limits, timeouts, concurrency controls, and safe fallback behavior.
- FR-054: Small model such as Qwen2.5-0.5B-Instruct may be evaluated for prototype use; it is not pre-approved for production until answer-quality and load tests pass.

### Monitoring, evaluation, logical infrastructure
- FR-060: Dashboard shows job counts, queue depth, worker status, error rates, and latency.
- FR-061: Provide health/readiness endpoints and structured logs with correlation IDs.
- FR-062: Record metrics without exposing document content, credentials, or sensitive prompts by default.
- FR-063: Provide a small evaluation dataset and repeatable retrieval/answer-quality test runner.
- FR-064: Logical racks show rack/node/resource/workload relationships and state provenance.
- FR-065: Distinguish live telemetry, manually configured state, and simulated state visually.
- FR-066: API and UI must not claim physical device control unless a supported integration is implemented.

## 4. Non-functional requirements
- Security: tenant isolation, least privilege, upload validation, secret management, audit logging.
- Reliability: durable jobs, bounded retries, idempotent stages, graceful failure.
- Scalability: stateless API where practical, horizontally scalable workers, queue-based backpressure.
- Observability: structured logs, metrics, correlation IDs, health checks.
- Maintainability: type checking, linting, migrations, documented interfaces, tests.
- Accessibility: keyboard navigation, visible focus, semantic labels, contrast.
- Usability: clear empty/loading/error states; status labels must not rely on color alone.
- Performance: define targets after baseline measurements on a declared environment.

## 5. MVP acceptance criteria
- A developer can launch the application using documented commands.
- An authorized user can upload supported documents and track processing state.
- Successful documents are chunked and indexed; failed documents expose actionable safe errors.
- A question returns a grounded answer with citations, or an explicit insufficient-evidence response.
- Retrieval never returns unauthorized chunks in automated access-control tests.
- Queue retries work and duplicate processing does not create duplicate chunks/vectors.
- Dashboard job totals match backend state.
- Logical rack UI labels seeded/simulated data honestly.
- Unit, integration, security, and end-to-end tests run in CI.
