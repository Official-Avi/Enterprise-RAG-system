// Data helpers shared by the public landing page and the simple /ask workspace.

import { api, ApiError, uploadFiles } from "./api";
import type { Collection, DemoInfo, Me, UploadItem } from "./types";

export const MY_DOCUMENTS = "My documents";
export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown"];
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 20;

/** Placeholder filename for chips added by track() until the documents data arrives. */
export const LOADING_FILENAME = "Loading…";

/** §5.5: after this long in one reading phase, chips switch to STILL_READING_COPY. */
export const STILL_READING_MS = 3 * 60_000;
export const STILL_READING_COPY = "Still reading. You'll find it in My documents.";

const hasAcceptedExtension = (name: string) =>
  ACCEPTED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|heic|heif|avif)$/i;

const isOldWordFile = (file: File) => file.name.toLowerCase().endsWith(".doc");
const isImage = (file: File) => file.type.startsWith("image/") || IMAGE_EXTENSION.test(file.name);

/** A dropped folder arrives as a File with no bytes and no type (§3.2 step 1). */
export function looksLikeFolder(file: File): boolean {
  return file.size === 0 && !file.type && !hasAcceptedExtension(file.name);
}

export type RejectionKind = "folder" | "old_word" | "image" | "type" | "empty" | "size";

export interface FileRejection {
  kind: RejectionKind;
  /** The sentence shown for a file rejected on its own (§3.2 rejected_* states). */
  message: string;
  /** Short reason for the skipped-files note, e.g. "not supported". */
  why: string;
}

/** Size for rejection copy, rounded up so a file just over the limit never reads as "25 MB". */
const roundedUpMb = (bytes: number) => `${Math.ceil((bytes / 1024 ** 2) * 10) / 10} MB`;

/** "report.pdf is 41.2 MB. The limit is 25 MB. Try compressing or splitting it." (§3.2) */
export function sizeRejectionCopy(filename: string, bytes: number): string {
  return `${filename} is ${roundedUpMb(bytes)}. The limit is 25 MB. Try compressing or splitting it.`;
}

/** Why a file can't be added, with the §3.2 copy; null when it can. Mirrors the API's limits. The
 *  server validates again, so this is only there to answer before anything is sent. */
export function fileRejection(file: File): FileRejection | null {
  const notSupported = (kind: RejectionKind, message: string): FileRejection => ({ kind, message, why: "not supported" });
  if (isOldWordFile(file)) {
    return notSupported("old_word", "Older Word files (.doc) aren't supported. Save the file as .docx in Word.");
  }
  if (isImage(file)) return notSupported("image", "Images aren't supported yet. Put them in a PDF first.");
  if (looksLikeFolder(file)) {
    return { kind: "folder", message: "Folders aren't supported. Drop the files inside instead.", why: "folder" };
  }
  if (!hasAcceptedExtension(file.name)) {
    return notSupported(
      "type",
      "That file type isn't supported. Use a PDF, Word (.docx), text or Markdown file. Scanned PDFs work too.",
    );
  }
  if (file.size === 0) return { kind: "empty", message: "This file is empty.", why: "empty" };
  if (file.size > MAX_FILE_BYTES) {
    return { kind: "size", message: sizeRejectionCopy(file.name, file.size), why: "over 25 MB" };
  }
  return null;
}

/** The §3.2 sentence for a rejected file, or null. The size sentence already names the file, so
 *  callers show this as it is, with no filename in front. */
export function checkFile(file: File): string | null {
  return fileRejection(file)?.message ?? null;
}

export interface SkippedFile {
  file: File;
  /** Short reason for the skipped-files note, e.g. "not supported". */
  why: string;
}

/** Split a pick/drop into files to upload (at most MAX_FILES) and files skipped in the browser. */
export function partitionFiles(files: File[]): { valid: File[]; skipped: SkippedFile[] } {
  const valid: File[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of files) {
    const why = fileRejection(file)?.why ?? (valid.length >= MAX_FILES ? `only ${MAX_FILES} at a time` : null);
    if (why) skipped.push({ file, why });
    else valid.push(file);
  }
  return { valid, skipped };
}

/** The most file bytes one upload request may carry. The proxy's cap (PROXY_BODY_LIMIT_BYTES, 26 MiB)
 *  also has to hold the multipart overhead of up to MAX_FILES parts, which the 1 MiB gap covers. */
export const MAX_REQUEST_BYTES = MAX_FILE_BYTES;

/** Split files into sequential upload requests of at most MAX_FILES files and MAX_REQUEST_BYTES in
 *  total, so every multipart body fits the /api proxy's body limit (next.config.ts; BUG-02, BUG-13).
 *  A single file is never split: each one is already capped at MAX_FILE_BYTES. */
export function requestGroups<T>(items: T[], sizeOf: (item: T) => number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = sizeOf(item);
    if (current.length && (current.length >= MAX_FILES || bytes + size > MAX_REQUEST_BYTES)) {
      groups.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) groups.push(current);
  return groups;
}

/** "2 files skipped: photo.png (not supported), big.pdf (over 25 MB)" (§3.2 mixed batch). */
export function skippedNote(skipped: SkippedFile[], maxListed = 5): string | null {
  if (!skipped.length) return null;
  const listed = skipped.slice(0, maxListed).map((s) => `${s.file.name || "folder"} (${s.why})`);
  if (skipped.length > maxListed) listed.push(`+${skipped.length - maxListed} more`);
  const count = `${skipped.length} ${skipped.length === 1 ? "file" : "files"} skipped`;
  return `${count}: ${listed.join(", ")}`;
}

/** "report.pdf is ready · 42 pages" or "3 files are ready: a.pdf, b.docx, +1 more" (§5.5). */
export function readyMessage(filenames: string[], pageCount?: number | null): string {
  if (filenames.length === 1) {
    const pages = pageCount ? ` · ${pageCount} ${pageCount === 1 ? "page" : "pages"}` : "";
    return `${filenames[0]} is ready${pages}`;
  }
  const listed = filenames.slice(0, 2);
  if (filenames.length > 2) listed.push(`+${filenames.length - 2} more`);
  return `${filenames.length} files are ready: ${listed.join(", ")}`;
}

export function fetchDemoInfo(): Promise<DemoInfo> {
  return api<DemoInfo>("/auth/demo", { noAuthRedirect: true });
}

export function demoLogin(persona: string, signal?: AbortSignal): Promise<Me> {
  return api<Me>("/auth/demo", { method: "POST", json: { persona }, noAuthRedirect: true, signal });
}

/** The current user, or null when signed out (never redirects). */
export async function currentUser(signal?: AbortSignal): Promise<Me | null> {
  try {
    return await api<Me>("/auth/me", { noAuthRedirect: true, signal });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

const writable = (c: Collection) => c.access_level === "write" || c.access_level === "manage";

/** The per-user fallback name used when "My documents" belongs to someone else (§3.2 step 4). */
export function personalCollectionName(displayName: string): string {
  return `${MY_DOCUMENTS} · ${displayName}`.slice(0, 200);
}

function pickMyDocuments(all: Collection[], displayName?: string): Collection | null {
  const mine = all.filter(writable);
  return (
    mine.find((c) => c.name === MY_DOCUMENTS) ??
    (displayName ? mine.find((c) => c.name === personalCollectionName(displayName)) : undefined) ??
    null
  );
}

/** The writable "My documents" (or its personal fallback) if it already exists. Never creates. */
export async function findMyDocuments(displayName?: string, signal?: AbortSignal): Promise<Collection | null> {
  return pickMyDocuments(await api<Collection[]>("/collections?limit=500", { signal, noAuthRedirect: true }), displayName);
}

const isNameTaken = (e: unknown) => e instanceof ApiError && e.status === 409;

async function createCollection(name: string, signal?: AbortSignal): Promise<Collection> {
  return api<Collection>("/collections", {
    method: "POST",
    json: { name, description: "Files added from the Ask page." },
    signal,
    noAuthRedirect: true,
  });
}

/** A writable "My documents" collection, created on first use. Names are unique per tenant, so
 *  when "My documents" exists but isn't writable for this user, "My documents · {display_name}"
 *  is used instead. Pass the display name when known to save a /auth/me round trip. */
export async function ensureMyDocuments(displayName?: string, signal?: AbortSignal): Promise<Collection> {
  const existing = await findMyDocuments(displayName, signal);
  if (existing) return existing;
  try {
    return await createCollection(MY_DOCUMENTS, signal);
  } catch (e) {
    if (!isNameTaken(e)) throw e;
  }
  const name = displayName ?? (await api<Me>("/auth/me", { signal, noAuthRedirect: true })).display_name;
  // Another tab may have just created "My documents", or the personal copy already exists.
  const again = await findMyDocuments(name, signal);
  if (again) return again;
  try {
    return await createCollection(personalCollectionName(name), signal);
  } catch (e) {
    const raced = isNameTaken(e) ? await findMyDocuments(name, signal) : null;
    if (raced) return raced;
    throw e;
  }
}

/** Upload a batch of any size into one collection, in input order. It goes as several requests when
 *  it has to (requestGroups); progress covers all of them, and an abort also stops the groups not
 *  yet sent. If a later request fails, the earlier ones have already been stored: sending the same
 *  files again is safe, because the API reports those as duplicates. */
export async function uploadInGroups(
  collectionId: string,
  files: File[],
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadItem[]> {
  const totalBytes = files.reduce((n, f) => n + f.size, 0) || 1;
  const items: UploadItem[] = [];
  let doneBytes = 0;
  for (const group of requestGroups(files, (f) => f.size)) {
    const groupBytes = group.reduce((n, f) => n + f.size, 0);
    const res = await uploadFiles<{ items: UploadItem[] }>(
      `/collections/${collectionId}/documents`,
      group,
      (p) => onProgress(Math.min(1, (doneBytes + p * groupBytes) / totalBytes)),
      signal,
    );
    items.push(...res.items);
    doneBytes += groupBytes;
  }
  return items;
}
