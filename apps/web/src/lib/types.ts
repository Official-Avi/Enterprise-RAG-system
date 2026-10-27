// Types mirror Docs/API_SPEC.md "Implemented v1 response contracts".

export type Uuid = string;

export interface Membership {
  tenant_id: Uuid;
  tenant_name: string;
  tenant_slug: string;
  role: string;
}

export interface Me {
  user_id: Uuid;
  email: string;
  display_name: string;
  tenant_id: Uuid;
  role: "org_admin" | "operator" | "engineer" | "auditor";
  permissions: string[];
  memberships: Membership[];
}

export interface Collection {
  id: Uuid;
  name: string;
  description: string;
  visibility: "tenant" | "restricted";
  access_level: "read" | "write" | "manage" | null;
  document_count: number;
  created_at: string;
  updated_at: string;
}

export type DocumentStatus = "queued" | "processing" | "indexed" | "failed" | "deleting" | "deleted";
export type JobStatus = "queued" | "running" | "retry_wait" | "succeeded" | "failed" | "cancelled";

export interface JobBrief {
  id: Uuid;
  job_type: string;
  status: JobStatus;
  stage: string | null;
  attempt_count: number;
  max_attempts: number;
  error_code: string | null;
  safe_error_message: string | null;
}

export interface Job extends JobBrief {
  document_id: Uuid | null;
  document_filename: string | null;
  collection_id: Uuid | null;
  priority: number;
  queued_at: string;
  available_at: string;
  started_at: string | null;
  finished_at: string | null;
  correlation_id: string | null;
  cancel_requested: boolean;
}

export interface Attempt {
  attempt_number: number;
  worker_id: string;
  status: string;
  stage: string | null;
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
  safe_error_message: string | null;
}

export interface StageRun {
  attempt_number: number;
  stage: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  details: Record<string, unknown>;
  error_code: string | null;
}

export interface JobDetail extends Job {
  attempts: Attempt[];
  stages: StageRun[];
}

export interface DocumentItem {
  id: Uuid;
  collection_id: Uuid;
  collection_name: string;
  filename: string;
  file_type: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus;
  page_count: number | null;
  chunk_count: number | null;
  token_count: number | null;
  extraction_method: string | null;
  ocr_page_count: number | null;
  quality_score: number | null;
  warnings: string[];
  pipeline_version: string | null;
  embedding_model: string | null;
  uploaded_by: Uuid | null;
  created_at: string;
  updated_at: string;
  indexed_at: string | null;
  latest_job: JobBrief | null;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface UploadItem {
  filename: string;
  status: "queued" | "duplicate" | "rejected";
  document_id: Uuid | null;
  job_id: Uuid | null;
  duplicate: boolean;
  error: { code: string; message: string } | null;
}

export interface Pipeline {
  document_id: Uuid;
  status: DocumentStatus;
  jobs: JobDetail[];
}

export interface ChunkItem {
  id: Uuid;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  token_count: number;
  text: string;
}

export interface Citation {
  marker: number;
  document_id: Uuid;
  filename: string;
  page: number | null;
  chunk_id: Uuid | null;
  quote: string;
  score: number | null;
}

export interface ModelRef {
  provider: string;
  name: string;
  deployment_mode?: string | null;
}

export interface ChatSession {
  id: Uuid;
  title: string;
  collection_ids: Uuid[];
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: Uuid;
  role: "user" | "assistant";
  content: string;
  evidence_status: "supported" | "insufficient" | null;
  citations: Citation[];
  model: ModelRef | null;
  latency_ms: number | null;
  created_at: string;
}

export interface AnswerResponse {
  message_id: Uuid;
  user_message_id: Uuid;
  answer: string;
  evidence_status: "supported" | "insufficient";
  citations: Citation[];
  model: ModelRef;
  latency_ms: number;
  retrieved_count: number;
}

export interface OpsSummary {
  jobs: Record<JobStatus, number>;
  queue_depth: number;
  oldest_queued_age_seconds: number | null;
  documents: Record<string, number>;
  indexed_chunks: number;
  workers: { total: number; healthy: number; stale: number };
  generated_at: string;
}

export interface Worker {
  worker_id: string;
  hostname: string;
  status: string;
  health: "healthy" | "stale" | "stopped";
  current_job_id: Uuid | null;
  jobs_succeeded: number;
  jobs_failed: number;
  started_at: string;
  last_heartbeat_at: string;
  version: string;
}

export interface OpsMetrics {
  window_seconds: number;
  buckets: { start: string; succeeded: number; failed: number }[];
  avg_job_duration_ms: number | null;
  p95_job_duration_ms: number | null;
  error_rate: number | null;
  stage_durations_ms: Record<string, number>;
}

export interface ModelInfo {
  provider: string;
  name: string;
  deployment_mode: string;
  is_default: boolean;
  timeout_seconds: number;
  max_concurrency: number;
}

export interface ModelHealth {
  ok: boolean;
  provider: string;
  model: string;
  deployment_mode: string;
  detail: string;
  latency_ms: number | null;
}

export interface ModelMetrics {
  window_seconds: number;
  requests: number;
  errors: number;
  timeouts: number;
  error_rate: number | null;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface InspectItem {
  chunk_id: Uuid;
  document_id: Uuid;
  filename: string;
  page_start: number | null;
  page_end: number | null;
  score: number;
  text: string;
}

export interface Member {
  user_id: Uuid;
  email: string;
  display_name: string;
  role: Me["role"];
  status: string;
  joined_at: string;
  last_login_at: string | null;
}

export interface Grant {
  user_id: Uuid;
  email: string;
  display_name: string;
  permission: "read" | "write" | "manage";
}

export interface AuditEvent {
  id: Uuid;
  created_at: string;
  actor_user_id: Uuid | null;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: string;
  correlation_id: string | null;
  metadata: Record<string, unknown>;
}

export interface TenantSettingsValues {
  retrieval_top_k: number | null;
  retrieval_score_threshold: number | null;
  chunk_size_tokens: number | null;
  chunk_overlap_tokens: number | null;
  ocr_enabled: boolean | null;
  max_storage_bytes: number | null;
}

export interface TenantSettings {
  effective: TenantSettingsValues;
  overrides: TenantSettingsValues;
  updated_at: string | null;
  note: string;
}

export type StateSource = "manual" | "simulated" | "integration";

export interface Capacity {
  cpu_cores: number;
  memory_bytes: number;
  storage_bytes: number;
  accelerators: number;
}

export interface Rack {
  id: Uuid;
  name: string;
  environment: string;
  location_label: string | null;
  description: string;
  rack_units: number | null;
  state_source: StateSource;
  status: string;
  node_count: number;
  capacity: Capacity;
  updated_at: string;
}

export interface NodeResource {
  id: Uuid;
  name: string;
  rack_id: Uuid | null;
  resource_type: string;
  rack_unit_position: number | null;
  cpu_cores: number | null;
  memory_bytes: number | null;
  accelerator_info: string | null;
  storage_bytes: number | null;
  state_source: StateSource;
  status: string;
  last_seen_at: string | null;
  allocated: Capacity;
  workload_count: number;
  updated_at: string;
}

export interface Workload {
  id: Uuid;
  name: string;
  workload_type: string;
  node_id: Uuid | null;
  node_name: string | null;
  rack_id: Uuid | null;
  desired_state: string;
  observed_state: string;
  resource_request: Record<string, number>;
  state_source: StateSource;
  updated_at: string;
}

export interface RackDetail extends Rack {
  nodes: NodeResource[];
  workloads: Workload[];
}

export interface InfraOverview {
  racks: Record<StateSource, number>;
  nodes: Record<StateSource, number>;
  workloads: Record<StateSource, number>;
  platform_processes: {
    worker_id: string;
    hostname: string;
    status: string;
    health: "healthy" | "stale" | "stopped";
    last_heartbeat_at: string;
    state_source: StateSource;
  }[];
  note: string;
}

export interface EvalDataset {
  version: string;
  description: string;
  questions: number;
  categories: Record<string, number>;
}

export type EvalMetricValue = number | null | Record<string, number>;

export interface EvalRun {
  id: Uuid;
  dataset_version: string;
  status: string;
  model: Record<string, string>;
  collection_ids: Uuid[];
  metrics: Record<string, EvalMetricValue>;
  created_by_email: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  job_id: Uuid | null;
}

export interface EvalResult {
  id: string;
  category: string;
  answerable?: boolean;
  question?: string;
  answer?: string;
  retrieved_docs?: string[];
  cited_docs?: string[];
  evidence_status?: string;
  retrieval_hit?: boolean | null;
  citation_correct?: boolean | null;
  term_recall?: number | null;
  injection_resisted?: boolean | null;
  restricted_leak?: boolean | null;
  error?: string;
  latency_ms?: number;
}

export interface EvalRunDetail extends EvalRun {
  results: EvalResult[];
}
