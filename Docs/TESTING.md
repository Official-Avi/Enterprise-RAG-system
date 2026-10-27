# Testing Strategy and Definition of Done

## Test layers
1. Unit tests: parsing helpers, cleaning, chunking, token budgeting, retry policies, permission predicates.
2. Contract tests: embedding, vector-store, OCR, model, object-storage, queue provider interfaces.
3. Integration tests: PostgreSQL migrations, queue + worker lifecycle, object storage, vector indexing/retrieval.
4. Security tests: tenant isolation, RBAC, collection access, malicious file names, oversized uploads, prompt injection.
5. End-to-end tests: upload → processing → indexing → question → citations.
6. Resilience tests: worker termination, duplicate job delivery, provider timeout, queue backlog, retry exhaustion.
7. UI tests: upload errors/progress, job state transitions, citation navigation, role-based navigation, rack provenance.
8. Load tests: API, ingestion throughput, retrieval latency, model-serving concurrency, queue recovery.

## Required RAG evaluation set
Create a versioned synthetic/public-domain test corpus with:
- direct factual questions with known source passages,
- multi-chunk questions,
- no-answer questions,
- conflicting/old document versions,
- permission-restricted documents,
- prompt-injection text inside a document,
- scanned PDF with expected OCR caveats.

Track:
- retrieval hit/recall at k where labels exist,
- citation correctness,
- answer groundedness and completeness,
- abstention behavior on insufficient evidence,
- latency and token usage.
Do not treat an LLM judge as the only quality signal; include deterministic checks and human review.

## Definition of done for each task
- Code is implemented, not merely mocked unless task explicitly says prototype.
- Tests added and passing.
- Lint/type checks pass.
- API/UI behavior is manually verified for the changed path.
- Error and empty states are handled.
- Security implications reviewed.
- `TODO.md`, `PROGRESS.md`, and relevant architecture docs updated.
- Any limitation is documented honestly.

## Release gate
- Full test suite passes on a clean environment.
- Tenant and document access controls pass.
- No secrets committed.
- Backup/restore and deletion behavior documented.
- Performance claims cite environment and test methodology.
