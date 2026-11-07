# RackFlow AI — Project Documentation Pack

This pack began as the brief for building **RackFlow AI**, a multi-tenant RAG pipeline and AI
infrastructure and workload management platform. The product now exists, so some documents describe
what was planned and others describe what was built. To run it, start from the
[root README](../README.md).

**RackFlow AI is not production ready.** See `PROGRESS.md`.

## Where to look

**Current state**
- `PROGRESS.md` — real status, open risks and the list of what has not been verified.
- `TODO.md` — task status by phase.
- `TESTING.md` — test strategy and the log of actual results.
- `RELEASE_NOTES.md` — changes per release, including the unreleased branch.
- `DECISIONS.md` — architecture decisions, including those awaiting the owner.

**How it is built**
- `API_SPEC.md` — REST API. The "Implemented" part is binding.
- `DESIGN.md` — the interface as built. `UI_DESIGN_SPEC.md` is the detailed spec behind it.
- `TECH_STACK.md` — what is used and why.
- `DEPLOYMENT.md` — deployment plan, and in §8 what is implemented and executed.
- `SECURITY.md` — security baseline, control status and open risks.
- `ARCHITECTURE.md`, `DATA_MODEL.md` — system structure and core entities.

**Original brief** (planning documents; check them against the code)
- `PID.md`, `PRD.md`, `AGENT_INSTRUCTIONS.md`.

**Point-in-time reports** (historical; not updated)
- `DELIVERY_REPORT.md` — the v0.1.0 sprint report of 2026-10-27. It calls the repository private; it is
  public now.
- `LIVE_CHECK_REPORT.md` — the 2026-10-29 live check, including the environment fault ENV-1, which no
  longer reproduces.

## Product boundary
RackFlow AI is a **software platform**. Its "rack" interface represents logical, registered
infrastructure, resources, services and workload placement. It must not claim to discover, power-cycle
or control real physical servers unless a future, explicitly configured integration is implemented and
tested.

## Implemented stack
- Frontend: Next.js, React, TypeScript, Tailwind CSS.
- Backend: Python 3.12, FastAPI.
- Metadata and jobs: PostgreSQL. Workers claim jobs with `SKIP LOCKED` and leases. There is **no Redis or
  Celery**; the brief proposed them, and ADR-005 records why they were not used.
- Vector search: Qdrant, behind a provider interface.
- File storage: a local volume. No S3-compatible adapter exists.
- RAG: local embeddings, and chat models behind a provider interface: built-in extractive (default, no
  LLM), Anthropic, or any OpenAI-compatible endpoint such as Groq or Ollama. See ADR-023.
- Observability: structured logs, job metrics, health checks. No tracing.
- Packaging: Docker Compose for Linux hosts; portable binaries on the Windows development host.
