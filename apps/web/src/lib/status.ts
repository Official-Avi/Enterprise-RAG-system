// The ONLY source of user-facing document/upload status words in the workspace
// (Docs/UI_DESIGN_SPEC.md §5.4). Pipeline vocabulary stays in the admin console.

export type UploadPhase =
  | "uploading"
  | "queued"
  | "processing"
  | "retry_wait"
  | "indexed"
  | "failed"
  | "deleting"
  | "duplicate"
  | "rejected";

export type StatusTone = "ok" | "warn" | "bad" | "info" | "neutral";

export interface StatusInfo {
  label: string;
  sub?: string;
  tone: StatusTone;
  /** Text glyph so status is never colour-only. */
  glyph: string;
  /** True once nothing more will change without user action. */
  terminal: boolean;
}

export interface StatusContext {
  progress?: number; // 0..1, uploads only
  pageCount?: number | null;
  elapsedMs?: number; // time spent in the current phase
  stage?: string | null; // latest pipeline stage, e.g. "ocr"
  reasonCode?: string | null;
  reasonMessage?: string | null;
  /** Replaces the sub-label while the phase isn't terminal (e.g. the 3-minute "Still reading"). */
  subOverride?: string | null;
}

const REASONS: Record<string, string> = {
  FILE_TOO_LARGE: "Too big. The limit is 25 MB.",
  UNSUPPORTED_TYPE: "This file type isn't supported.",
  CONTENT_MISMATCH: "This doesn't look like a real PDF or Word file.",
  MACROS_NOT_ALLOWED: "Word files with macros aren't allowed. Save it as a normal .docx.",
  EMPTY_FILE: "This file is empty.",
  EMPTY_DOCUMENT: "This file is empty.",
  CORRUPT_FILE: "This file seems damaged. Try saving it again.",
  UNREADABLE_TEXT: "We couldn't find readable text, even with text recognition.",
  ARCHIVE_BOMB: "This file is too complex to open safely.",
  ARCHIVE_TOO_COMPLEX: "This file is too complex to open safely.",
  QUOTA_EXCEEDED: "Your workspace is full. Remove a file to make room.",
  DEPENDENCY_UNAVAILABLE: "The server can't read files right now. An administrator needs to check it.",
};

export function reasonCopy(code?: string | null): string {
  return (code && REASONS[code]) || "Something went wrong while reading this file.";
}

export const TERMINAL_PHASES: ReadonlySet<UploadPhase> = new Set(["indexed", "failed", "duplicate", "rejected"]);

export function describeStatus(phase: UploadPhase, ctx: StatusContext = {}): StatusInfo {
  const info = baseStatus(phase, ctx);
  return ctx.subOverride && !info.terminal ? { ...info, sub: ctx.subOverride } : info;
}

function baseStatus(phase: UploadPhase, ctx: StatusContext): StatusInfo {
  const elapsed = ctx.elapsedMs ?? 0;
  switch (phase) {
    case "uploading":
      return {
        label: ctx.progress !== undefined ? `Uploading ${Math.round(ctx.progress * 100)}%` : "Uploading",
        tone: "info",
        glyph: "↑",
        terminal: false,
      };
    case "queued":
      return {
        label: "Waiting",
        sub: elapsed > 30_000 ? "Other files are being read first" : "In line to be read",
        tone: "neutral",
        glyph: "◷",
        terminal: false,
      };
    case "processing":
      return {
        label: "Reading",
        sub:
          ctx.stage === "ocr"
            ? "Reading scanned pages"
            : elapsed > 90_000
              ? "Taking longer than usual"
              : "Usually under a minute",
        tone: "info",
        glyph: "◐",
        terminal: false,
      };
    case "retry_wait":
      return { label: "Reading", sub: "Hit a snag, trying again", tone: "warn", glyph: "↻", terminal: false };
    case "indexed":
      return {
        label: "Ready",
        sub: ctx.pageCount ? `${ctx.pageCount} ${ctx.pageCount === 1 ? "page" : "pages"}` : undefined,
        tone: "ok",
        glyph: "✓",
        terminal: true,
      };
    case "failed":
      return { label: "Couldn't read", sub: reasonCopy(ctx.reasonCode), tone: "bad", glyph: "⚠", terminal: true };
    case "deleting":
      return { label: "Removing", tone: "neutral", glyph: "⌫", terminal: false };
    case "duplicate":
      return { label: "Already added", sub: "Using the copy you already have", tone: "neutral", glyph: "⧉", terminal: true };
    case "rejected":
      return {
        label: "Not accepted",
        sub: ctx.reasonCode ? reasonCopy(ctx.reasonCode) : (ctx.reasonMessage ?? reasonCopy(null)),
        tone: "bad",
        glyph: "⊘",
        terminal: true,
      };
  }
}

/** Map a document's backend status (+ latest job status) to a workspace phase. */
export function phaseFromDocument(status: string, jobStatus?: string | null): UploadPhase {
  // A job can fail before the worker marks the document processing, so check both states.
  if ((status === "processing" || status === "queued") && jobStatus === "retry_wait") return "retry_wait";
  if (status === "queued" || status === "processing" || status === "indexed" || status === "failed" || status === "deleting") {
    return status;
  }
  return "queued";
}

/** Middle-truncate a filename so the extension stays visible. */
export function middleTruncate(name: string, max = 32): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  const keep = max - ext.length - 1;
  return `${name.slice(0, Math.ceil(keep * 0.7))}…${name.slice(name.length - ext.length - Math.floor(keep * 0.3))}`;
}
