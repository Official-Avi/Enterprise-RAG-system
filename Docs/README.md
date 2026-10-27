# RackFlow AI — Project Documentation Pack

This pack is the source of truth for an AI coding agent or cloud development environment building **RackFlow AI**, a multi-tenant RAG pipeline and AI infrastructure/workload management platform.

## How to start
1. Upload/extract this whole folder into the project workspace.
2. Give the coding agent `AGENT_INSTRUCTIONS.md` first, then ask it to read `PID.md`, `PRD.md`, and `ARCHITECTURE.md`.
3. Ask it to implement **Phase 0 and Phase 1 only** from `TODO.md`; do not generate the entire codebase in one unreviewed pass.
4. After each phase, require tests, a concise summary, and updates to `PROGRESS.md` and `TODO.md`.
5. Commit each working phase before moving on.

## Documents
- `PID.md` — Project Initiation Document: purpose, scope, outcomes, constraints.
- `PRD.md` — product requirements, users, workflows, acceptance criteria.
- `ARCHITECTURE.md` — system architecture, modules, data flow, scaling approach.
- `DESIGN.md` — interface and UX system, including the enterprise rack-management UI.
- `TODO.md` — ordered implementation plan with checkboxes.
- `PROGRESS.md` — status tracker; the agent must update it as work is completed.
- `API_SPEC.md` — initial REST API contract.
- `DATA_MODEL.md` — core entities and relationships.
- `SECURITY.md` — tenant isolation, RBAC, secrets, safe document processing.
- `TESTING.md` — test strategy and definition of done.
- `DEPLOYMENT.md` — local development and staged deployment strategy.
- `DECISIONS.md` — architectural decisions and assumptions.
- `AGENT_INSTRUCTIONS.md` — operating instructions for the coding agent.

## Product boundary
RackFlow AI is initially a **software platform**. Its “rack” interface represents logical/registered infrastructure, resources, services, and workload placement. It must not claim to discover, power-cycle, or control real physical servers unless a future, explicitly configured integration is implemented and tested.

## Recommended MVP stack
- Frontend: Next.js + TypeScript + Tailwind CSS + a consistent accessible component system.
- Backend: Python + FastAPI.
- Metadata: PostgreSQL.
- Async jobs: Redis + Celery (or RQ; choose one and document the choice).
- Vector search: Qdrant, behind a provider interface.
- File/object storage: local storage for development, S3-compatible storage for deployment.
- RAG: provider interfaces for embeddings and chat models; start with a small instruct model only if it meets quality/latency tests. Do not hardwire the product to one model.
- Observability: structured logs, job metrics, health checks; add OpenTelemetry-compatible traces in a later phase.
- Packaging: Docker Compose for local development.

These are proposed defaults, not claims that the components are already implemented. The agent should verify current compatible versions before installation and pin dependencies.
