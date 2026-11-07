import type { Page, Route } from "@playwright/test";
import type {
  ChatMessage,
  ChatSession,
  ChatSessionDetail,
  Citation,
  Collection,
  DocumentItem,
  EvalRunDetail,
  Grant,
  JobDetail,
  RackDetail,
} from "../src/lib/types";

// Fixed API responses for the states a live stack can't be relied on to show: a failed row, a held
// upload, an answered chat, every console dialog. Only the responses are fake, the pages and
// components are the real ones, and nothing here reaches the database.

const NOW = "2026-11-06T09:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const MY_DOCS_ID = id(1);
export const FULL_COLLECTION_ID = id(2);
export const READY_DOC_ID = id(10);
export const CHAT_ID = id(20);
export const JOB_ID = id(30);
export const RUN_ID = id(40);
export const RACK_ID = id(50);

export const READY_FILE = "e2e-a11y-backup-policy.pdf";
export const FAILED_FILE = "e2e-a11y-scan.pdf";
export const READING_FILE = "e2e-a11y-reading.pdf";
export const CHAT_TITLE = "e2e-a11y backup retention";
export const EMPTY_COLLECTION = "e2e-a11y empty";
export const FULL_COLLECTION = "e2e-a11y full";
export const GRANTEE_EMAIL = "e2e-a11y-grantee@acme.example.com";
export const SHARED_COLLECTION = "e2e-library shared";
export const SHARED_FILE = "e2e-library-shared.pdf";
export const SHARED_DOC_ID = id(13);

function collection(over: Partial<Collection>): Collection {
  return {
    id: MY_DOCS_ID,
    name: "My documents",
    description: "",
    visibility: "restricted",
    access_level: "manage",
    document_count: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  };
}

function document(over: Partial<DocumentItem>): DocumentItem {
  return {
    id: READY_DOC_ID,
    collection_id: MY_DOCS_ID,
    collection_name: "My documents",
    filename: READY_FILE,
    file_type: "pdf",
    mime_type: "application/pdf",
    size_bytes: 120_000,
    status: "indexed",
    page_count: 4,
    chunk_count: 8,
    token_count: 900,
    extraction_method: "text",
    ocr_page_count: 0,
    quality_score: 0.9,
    warnings: [],
    pipeline_version: "1",
    embedding_model: "e2e",
    uploaded_by: null,
    created_at: NOW,
    updated_at: NOW,
    indexed_at: NOW,
    latest_job: null,
    ...over,
  };
}

const READY_DOC = document({});
const FAILED_DOC = document({
  id: id(11),
  filename: FAILED_FILE,
  status: "failed",
  page_count: null,
  indexed_at: null,
  latest_job: {
    id: id(31),
    job_type: "ingest_document",
    status: "failed",
    stage: "extract",
    attempt_count: 3,
    max_attempts: 3,
    error_code: "NO_EXTRACTABLE_TEXT",
    safe_error_message: "No readable text was found.",
  },
});
const READING_DOC = document({
  id: id(12),
  filename: READING_FILE,
  status: "processing",
  page_count: null,
  indexed_at: null,
  latest_job: {
    id: id(32),
    job_type: "ingest_document",
    status: "running",
    stage: "embed",
    attempt_count: 1,
    max_attempts: 3,
    error_code: null,
    safe_error_message: null,
  },
});

const CITATIONS: Citation[] = [
  {
    marker: 1,
    document_id: READY_DOC_ID,
    filename: READY_FILE,
    page: 2,
    chunk_id: id(60),
    quote: "Backups run nightly at 02:00 and are kept for thirty days.",
    score: 0.9,
  },
  {
    marker: 2,
    document_id: READY_DOC_ID,
    filename: READY_FILE,
    page: 3,
    chunk_id: id(61),
    quote: "The platform team owns the retention schedule.",
    score: 0.6,
  },
];

const SESSION: ChatSession = {
  id: CHAT_ID,
  title: CHAT_TITLE,
  collection_ids: [MY_DOCS_ID],
  created_at: NOW,
  updated_at: NOW,
};

function userMessage(n: number, content: string): ChatMessage {
  return {
    id: id(70 + n),
    role: "user",
    content,
    evidence_status: null,
    citations: [],
    model: null,
    latency_ms: null,
    retrieved_count: null,
    created_at: NOW,
  };
}

function answerMessage(n: number, over: Partial<ChatMessage>): ChatMessage {
  return {
    id: id(80 + n),
    role: "assistant",
    retrieved_count: null,
    content: "",
    evidence_status: "supported",
    citations: CITATIONS,
    model: { provider: "anthropic", name: "e2e-model" },
    latency_ms: 40,
    created_at: NOW,
    ...over,
  };
}

/** Oldest first. The newest answer has inline chips, which is what the sources panel opens on. */
const CHAT_MESSAGES: ChatMessage[] = [
  userMessage(1, "Who approves a retention exception?"),
  answerMessage(1, {
    content: "Your documents don't answer this.",
    evidence_status: "insufficient",
    citations: [],
    model: { provider: "extractive", name: "extractive-v1" },
  }),
  userMessage(2, "How long are backups kept? Quote it."),
  answerMessage(2, {
    content: "Backups run nightly at 02:00 and are kept for thirty days. [1]\n\nThe platform team owns the retention schedule. [2]",
    model: { provider: "extractive", name: "extractive-v1" },
  }),
  userMessage(3, "How long are backups kept?"),
  answerMessage(3, { content: "Backups are kept for thirty days [1]. The platform team owns the schedule [2]." }),
];

async function respond(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Answers GET requests to `url` only: anything else carries on to the real server. */
async function mockGet(page: Page, url: RegExp, body: (url: URL) => unknown): Promise<void> {
  await page.route(url, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await respond(route, body(new URL(route.request().url())));
  });
}

const COLLECTIONS_URL = /\/api\/v1\/collections(\?.*)?$/;
const DOCUMENTS_URL = /\/api\/v1\/documents(\?.*)?$/;
const UPLOAD_URL = /\/api\/v1\/collections\/[^/]+\/documents$/;

/** Documents and collections for one signed-in persona. `/documents?status=` filters as the API does. */
async function mockLibraryData(page: Page, docs: DocumentItem[], collections: Collection[]): Promise<void> {
  await mockGet(page, COLLECTIONS_URL, () => collections);
  await mockGet(page, DOCUMENTS_URL, (url) => {
    const status = url.searchParams.get("status");
    return { items: status ? docs.filter((d) => d.status === status) : docs, next_cursor: null };
  });
}

/** A Ready file and a failed one in My documents. */
export const mockDocuments = (page: Page) =>
  mockLibraryData(page, [READY_DOC, FAILED_DOC], [collection({ document_count: 2 })]);

/** One file still being read, so the scope chip says "1 getting ready". */
export const mockReadingDocuments = (page: Page) =>
  mockLibraryData(page, [READY_DOC, READING_DOC], [collection({ document_count: 2 })]);

export const mockNoDocuments = (page: Page) => mockLibraryData(page, [], [collection({})]);

/** A Ready file in My documents and a Ready file in a collection this user only reads. `/documents`
 *  narrows by collection as the API does, and the second file can be fetched on its own. */
export async function mockSharedDocument(page: Page): Promise<void> {
  const shared = document({
    id: SHARED_DOC_ID,
    collection_id: FULL_COLLECTION_ID,
    collection_name: SHARED_COLLECTION,
    filename: SHARED_FILE,
  });
  const docs = [READY_DOC, shared];
  await mockGet(page, COLLECTIONS_URL, () => [
    collection({ document_count: 1 }),
    collection({ id: FULL_COLLECTION_ID, name: SHARED_COLLECTION, access_level: "read", document_count: 1 }),
  ]);
  await mockGet(page, DOCUMENTS_URL, (url) => {
    const only = url.searchParams.get("collection_id");
    return { items: only ? docs.filter((d) => d.collection_id === only) : docs, next_cursor: null };
  });
  await mockGet(page, /\/api\/v1\/documents\/[^/?]+$/, () => shared);
}

/** A failed file in a collection where this user holds `level`, listed for as long as it exists. */
export async function mockFailedFile(
  page: Page,
  {
    level,
    uploadedBy = null,
    deleteRemovedIt = false,
  }: {
    level: Collection["access_level"];
    uploadedBy?: string | null;
    /** DELETE answers 404 either way: was the file already gone, or was the caller refused? */
    deleteRemovedIt?: boolean;
  },
): Promise<void> {
  const failed = {
    ...FAILED_DOC,
    collection_id: FULL_COLLECTION_ID,
    collection_name: SHARED_COLLECTION,
    uploaded_by: uploadedBy,
  };
  const docs = [failed];
  await mockLibraryData(page, docs, [
    collection({}),
    collection({ id: FULL_COLLECTION_ID, name: SHARED_COLLECTION, access_level: level, document_count: 1 }),
  ]);
  const notFound = { error: { code: "DOCUMENT_NOT_FOUND", message: "The requested document could not be found." } };
  await page.route(`**/api/v1/documents/${failed.id}`, async (route) => {
    if (route.request().method() === "DELETE") {
      if (deleteRemovedIt) docs.length = 0;
      return respond(route, notFound, 404);
    }
    return docs.length ? respond(route, failed) : respond(route, notFound, 404);
  });
  await page.route(`**/api/v1/documents/${failed.id}/retry`, (route) => respond(route, notFound, 404));
}

/** Holds the upload POST so the row stays Uploading. Call the result to let the request go. */
export async function holdUploads(page: Page): Promise<() => Promise<void>> {
  const held: Route[] = [];
  await page.route(UPLOAD_URL, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    held.push(route);
  });
  return async () => {
    await page.unroute(UPLOAD_URL);
    await Promise.all(held.map((route) => route.abort().catch(() => undefined)));
  };
}

/** The server turns every uploaded file down. */
export async function rejectUploads(page: Page, filename: string): Promise<void> {
  await page.route(UPLOAD_URL, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await respond(
      route,
      {
        items: [
          {
            filename,
            status: "rejected",
            document_id: null,
            job_id: null,
            duplicate: false,
            error: { code: "CONTENT_MISMATCH", message: "The file content is not a PDF." },
          },
        ],
      },
      201,
    );
  });
}

/** The server stores the file as `documentId`, which the document list doesn't show yet. */
export async function acceptUploads(page: Page, filename: string, documentId: string): Promise<void> {
  await mockLibraryData(page, [READY_DOC], [collection({ document_count: 1 })]);
  await mockGet(page, /\/api\/v1\/documents\/[^/?]+$/, () =>
    document({ id: documentId, filename, status: "queued", page_count: null, indexed_at: null }),
  );
  await page.route(UPLOAD_URL, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await respond(
      route,
      { items: [{ filename, status: "queued", document_id: documentId, job_id: id(33), duplicate: false, error: null }] },
      201,
    );
  });
}

/** One saved chat: a not-found answer, an extractive answer and a Claude answer with chips. */
export async function mockChat(page: Page): Promise<void> {
  await mockGet(page, /\/api\/v1\/chat\/sessions(\?.*)?$/, () => ({ items: [SESSION], next_cursor: null }));
  await mockGet(page, /\/api\/v1\/chat\/sessions\/[^/?]+$/, (): ChatSessionDetail => ({
    session: SESSION,
    messages: CHAT_MESSAGES,
  }));
}

/** A first question: the new chat is created and answered without touching the server. */
export async function mockFirstQuestion(page: Page, question: string): Promise<void> {
  const detail: ChatSessionDetail = {
    session: SESSION,
    messages: [userMessage(9, question), answerMessage(9, { content: "Backups are kept for thirty days [1]." })],
  };
  await page.route(/\/api\/v1\/chat\/sessions(\?.*)?$/, async (route) => {
    if (route.request().method() === "POST") return respond(route, SESSION, 201);
    await respond(route, { items: [], next_cursor: null });
  });
  await page.route(/\/api\/v1\/chat\/sessions\/[^/?]+$/, async (route) => {
    if (route.request().method() === "PATCH") return respond(route, SESSION);
    await respond(route, detail);
  });
  await page.route(/\/api\/v1\/chat\/sessions\/[^/?]+\/messages$/, async (route) => {
    await respond(route, {
      message_id: id(89),
      user_message_id: id(79),
      answer: "Backups are kept for thirty days [1].",
      evidence_status: "supported",
      citations: CITATIONS.slice(0, 1),
      model: { provider: "anthropic", name: "e2e-model" },
      latency_ms: 40,
      retrieved_count: 4,
    });
  });
}

const JOB_DETAIL: JobDetail = {
  id: JOB_ID,
  job_type: "ingest_document",
  status: "running",
  stage: "embed",
  attempt_count: 2,
  max_attempts: 3,
  error_code: "PROVIDER_TIMEOUT",
  safe_error_message: "The embedding service timed out.",
  document_id: READY_DOC_ID,
  document_filename: READY_FILE,
  collection_id: MY_DOCS_ID,
  priority: 5,
  queued_at: NOW,
  available_at: NOW,
  started_at: NOW,
  finished_at: null,
  correlation_id: "e2e-a11y-correlation",
  cancel_requested: false,
  attempts: [
    {
      attempt_number: 1,
      worker_id: "e2e-worker",
      status: "failed",
      stage: "embed",
      started_at: NOW,
      finished_at: NOW,
      error_code: "PROVIDER_TIMEOUT",
      safe_error_message: "The embedding service timed out.",
    },
  ],
  stages: [
    {
      attempt_number: 1,
      stage: "extract",
      status: "succeeded",
      started_at: NOW,
      finished_at: NOW,
      duration_ms: 120,
      details: {},
      error_code: null,
    },
  ],
};

const RUN_DETAIL: EvalRunDetail = {
  id: RUN_ID,
  dataset_version: "v1",
  status: "completed",
  model: { provider: "extractive", model: "extractive-v1" },
  collection_ids: [MY_DOCS_ID],
  metrics: { retrieval_hit_rate: 0.9, mrr: 0.8, errors: 0 },
  created_by_email: "admin@acme.example.com",
  created_at: NOW,
  started_at: NOW,
  finished_at: NOW,
  job_id: JOB_ID,
  results: [
    {
      id: "q1",
      category: "factual",
      question: "How long are backups kept?",
      evidence_status: "supported",
      retrieval_hit: true,
      citation_correct: true,
      term_recall: 1,
      injection_resisted: true,
      restricted_leak: false,
    },
    { id: "q2", category: "injection", error: "provider_timeout" },
  ],
};

const RACK_DETAIL: RackDetail = {
  id: RACK_ID,
  name: "e2e-a11y-rack",
  environment: "production",
  location_label: "Hall A",
  description: "",
  rack_units: 42,
  state_source: "simulated",
  status: "healthy",
  node_count: 0,
  capacity: { cpu_cores: 0, memory_bytes: 0, storage_bytes: 0, accelerators: 0 },
  updated_at: NOW,
  nodes: [],
  workloads: [],
};

const GRANTS: Grant[] = [
  { user_id: id(90), email: GRANTEE_EMAIL, display_name: "E2E Grantee", permission: "read" },
];

/** Enough of the console for every dialog to open, whatever this stack happens to hold. */
export async function mockConsole(page: Page): Promise<void> {
  await mockLibraryData(
    page,
    [READY_DOC, FAILED_DOC],
    [
      collection({ name: EMPTY_COLLECTION, description: "Nothing in it yet." }),
      collection({ id: FULL_COLLECTION_ID, name: FULL_COLLECTION, visibility: "tenant", document_count: 3 }),
    ],
  );
  await mockGet(page, /\/api\/v1\/collections\/[^/]+\/permissions$/, () => GRANTS);
  await mockGet(page, /\/api\/v1\/jobs(\?.*)?$/, () => ({ items: [JOB_DETAIL], next_cursor: null }));
  await mockGet(page, /\/api\/v1\/jobs\/[^/?]+$/, () => JOB_DETAIL);
  await mockGet(page, /\/api\/v1\/evaluation\/runs$/, () => [RUN_DETAIL]);
  await mockGet(page, /\/api\/v1\/evaluation\/runs\/[^/?]+$/, () => RUN_DETAIL);
  await mockGet(page, /\/api\/v1\/infrastructure\/racks\/[^/?]+$/, () => RACK_DETAIL);
}

/** "Add member" creates the account: the dialog moves on to its one-time password panel. */
export async function mockAddMember(page: Page): Promise<void> {
  await page.route(/\/api\/v1\/admin\/users$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await respond(route, { temporary_password: "not-a-real-password" }, 201);
  });
}
