# UX and Interface Design — RackFlow AI

## 1. Design direction
Create a premium, calm, enterprise operations console: dense enough for operators, clear enough for engineers. Use a restrained neutral foundation, high-contrast text, consistent spacing, and one accent color. Avoid excessive neon/glow, decorative 3D hardware, and visual noise. The product should look credible as enterprise infrastructure software.

## 2. Main navigation
- Overview
- Knowledge Base
  - Collections
  - Documents
  - Uploads / Processing
- AI Playground
  - Chat
  - Retrieval inspector (operator/admin permission)
- Operations
  - Job Queue
  - Workers
  - Model Serving
  - Evaluation
- Infrastructure
  - Rack Overview
  - Rack Detail
  - Nodes / Resources
  - Workload Placement
- Administration
  - Users & Roles
  - Audit Log
  - Settings

Hide or disable sections the current role cannot access. Navigation must not be treated as a security boundary; backend authorization remains mandatory.

## 3. Core screens

### Overview dashboard
- KPI cards: documents, queued jobs, running jobs, failed jobs, indexed chunks, model request latency.
- Processing pipeline status and recent incidents.
- Queue depth / completion trend chart.
- Worker health list.
- Model endpoint health.
- Logical rack/resource summary with state provenance.
- Every metric has a time window and loading/empty/error state.

### Document library
- Search and filters: collection, file type, status, uploaded date, uploader.
- Table columns: filename, collection, type, size, processing state, pages/chunks, uploaded at, actions.
- Bulk upload with progress, validation results, duplicate warnings.
- Detail view: stage timeline, extracted-text quality, warnings, retry/reprocess action if authorized.
- Never display a successful state before indexing has actually completed.

### Chat
- Collection selector limited to authorized collections.
- Answer panel with citation chips; clicking a citation opens the permitted source at a page/chunk.
- “Evidence found” and “insufficient evidence” states.
- Optional “show retrieved sources” panel for debugging.
- Clear warning that answers are generated and should be verified for critical operations.
- Do not show citations that were not used or sources the user cannot access.

### Operations / job queue
- Filters: state, type, collection, time, attempts.
- States: queued, running, retry_wait, succeeded, failed, cancelled.
- Job detail: safe error summary, attempt history, stage, timestamps, correlation ID.
- Retry and cancel buttons appear only when allowed and valid for the state.
- Show backpressure/queue-age indicators.

### Model Serving
- Configured model/provider, health, timeout, concurrency limit, recent latency, error rate.
- Do not expose credentials.
- Show model identifier and deployment mode (local/remote).
- Capacity values must come from real measurements or be labelled estimates.

### Enterprise rack interface
- Rack list cards/table with rack name, environment, location label (optional), state source, node count, capacity summary, health.
- Rack detail: front-view logical rack diagram with rack units/slots only if the data model supports them; otherwise use a clear node/resource grid.
- Node/resource cards show CPU, memory, accelerator, storage and assigned workload where available.
- Workload placement view shows which logical resources are assigned to API, workers, vector DB, or model-serving workloads.
- Filters for environment, state, workload, and source.
- Use badges: `Configured`, `Simulated`, `Integration-reported`, `Unknown`.
- No controls that imply power cycling or live hardware control in MVP.
- Responsive behavior: wide desktop-first operator layout, usable tablet layout, mobile read-only fallback.

### Admin and audit
- User list, role assignment, collection access.
- Confirm dangerous permission changes.
- Audit table with actor, action, resource, timestamp, outcome, correlation ID.
- Avoid logging raw secrets, full document text, or unnecessarily sensitive query content.

## 4. UI states
Every page must include loading, empty, error, success, permission-denied, and stale-data states as appropriate. Use skeletons sparingly. Include accessible labels, keyboard focus, responsive tables, and non-color status indicators.

## 5. Component inventory
- App shell / sidebar / workspace selector
- Breadcrumbs and page title
- KPI card
- Status badge
- Data table with filters and pagination
- Upload dropzone and file queue
- Pipeline stage timeline
- Job detail drawer/page
- Queue/latency chart
- Citation chip and source panel
- Model endpoint card
- Rack/resource card and node grid
- Confirmation dialog
- Toast/inline alert
- Audit event row

## 6. Acceptance criteria
- The operator can identify queue backlog and failed jobs in under a few interactions.
- The engineer can upload, see processing state, ask a question, and inspect citations.
- Rack state provenance is always visible.
- All critical actions are keyboard accessible and have clear confirmation/feedback.
- Unauthorized data never appears in UI responses, including search results and counts where those counts could reveal sensitive existence.
