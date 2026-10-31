// Shared contracts for the /ask workspace (Docs/UI_DESIGN_SPEC.md §5). Every workspace
// component builds against these types; change them only with the lead's agreement.

import type { ApiError } from "@/lib/api";
import type { UploadPhase } from "@/lib/status";
import type { ChatSession, Citation, Collection, DemoInfo, DemoPersona, Me, ModelRef } from "@/lib/types";

/** One file the user added in this tab (or that arrived via ?doc=), shown as a chip. */
export interface TrackedUpload {
  key: string; // local id, stable for React keys
  filename: string;
  sizeBytes: number | null;
  phase: UploadPhase;
  progress?: number; // 0..1 while uploading
  documentId?: string;
  reasonCode?: string | null;
  reasonMessage?: string | null;
  pageCount?: number | null;
  stage?: string | null; // latest pipeline stage while reading (e.g. "ocr")
  phaseSince: number; // ms timestamp of the last phase change
}

export interface UploadsApi {
  /** Uploads started in this tab, newest first. */
  items: TrackedUpload[];
  /** Validate, ensure "My documents", upload (one multipart POST of <= 20), then poll. */
  add(files: File[]): Promise<void>;
  /** Watch documents uploaded elsewhere (e.g. `?doc=` from the landing page). */
  track(documentIds: string[]): void;
  /** Stop showing a chip. Never deletes the document. */
  remove(key: string): void;
  /** Open the native file picker (the keyboard-accessible path for every dropzone). */
  pickFiles(): void;
  /** "My documents" once found or created. */
  myCollection: Collection | null;
  /** Client pre-check note, e.g. "2 files skipped: photo.png (not supported)". */
  rejectedNote: string | null;
  clearRejectedNote(): void;
  canUpload: boolean;
}

export interface WorkspaceApi {
  me: Me;
  /** Refetch /auth/me (after a persona switch). */
  reloadMe(): void;
  canChat: boolean;
  canUpload: boolean;
  /** Console entry for roles with ops:read, audit:read, user:read or settings:manage; else null. */
  consoleHref: string | null;
  demo: DemoInfo | null;
  /** The demo persona the user is signed in as, if any. */
  persona: DemoPersona | null;
  sessions: { items: ChatSession[]; loading: boolean; error: ApiError | undefined; reload(): void };
  /** Show a just-created chat at the top of Recent before the list reloads. */
  addOptimisticSession(session: ChatSession): void;
  /** Open the mobile/collapsed sidebar drawer. */
  openSidebar(): void;
  /** Polite screen-reader announcement via #sr-announcer. Never pass percentages. */
  announce(message: string): void;
}

/** An answer, from a fresh POST response or reconstructed from history. */
export interface AnswerView {
  id: string;
  text: string;
  evidence_status: "supported" | "insufficient";
  citations: Citation[];
  model: ModelRef | null;
  latency_ms: number | null;
  /** Number of retrieved passages; null when loaded from history. */
  retrieved_count: number | null;
}

export type TurnStatus = "held" | "waiting" | "answered" | "error";

export interface Turn {
  id: string;
  question: string;
  status: TurnStatus;
  answer?: AnswerView;
  error?: ApiError;
  /** Filenames a held question is waiting for. */
  heldFor?: string[];
  startedAt: number;
  /** e.g. "Searched 9 documents in HR Policies, Safety". */
  scopeLabel?: string;
}

export interface ScopeCollection {
  id: string;
  name: string;
  readyCount: number;
  pendingCount: number;
}

/** "all" = every collection the user can read (the default for every new chat). */
export type ScopeValue = "all" | string[];

export type AskStateKey =
  | "loading"
  | "auditor" // E
  | "operator_empty" // D
  | "upload_empty" // A
  | "reading" // C
  | "ready" // B
  | "not_found"; // F

export interface NotFoundContext {
  documentCount: number;
  readingCount: number;
  narrowed: boolean;
  canUpload: boolean;
  onSearchAll(): void;
  onUpload(): void;
}

export type AnswerMode = "extractive" | "llm";

export type { ChatSession, Citation, Collection, DemoInfo, DemoPersona, Me, ModelRef };
