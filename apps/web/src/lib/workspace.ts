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

/** Client-side pre-check mirroring the API's limits; the server validates again. */
export function checkFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return "Only PDF, Word (.docx), text and Markdown files can be added.";
  }
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_FILE_BYTES) return "This file is larger than 25 MB.";
  return null;
}

const hasAcceptedExtension = (name: string) =>
  ACCEPTED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));

/** A dropped folder arrives as a File with no bytes and no type (§3.2 step 1). */
export function looksLikeFolder(file: File): boolean {
  return file.size === 0 && !file.type && !hasAcceptedExtension(file.name);
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
    let why: string | null = null;
    if (looksLikeFolder(file)) why = "folder";
    else if (!hasAcceptedExtension(file.name)) why = "not supported";
    else if (file.size === 0) why = "empty";
    else if (file.size > MAX_FILE_BYTES) why = "over 25 MB";
    else if (valid.length >= MAX_FILES) why = `only ${MAX_FILES} at a time`;
    if (why) skipped.push({ file, why });
    else valid.push(file);
  }
  return { valid, skipped };
}

/** Split files into sequential upload requests of at most MAX_FILES files and MAX_FILE_BYTES in
 *  total, so every multipart body fits the /api proxy's body limit (next.config.ts; BUG-02).
 *  A single file is never split: each one is already capped at MAX_FILE_BYTES. */
export function requestGroups<T>(items: T[], sizeOf: (item: T) => number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = sizeOf(item);
    if (current.length && (current.length >= MAX_FILES || bytes + size > MAX_FILE_BYTES)) {
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

export function demoLogin(persona: string): Promise<Me> {
  return api<Me>("/auth/demo", { method: "POST", json: { persona }, noAuthRedirect: true });
}

/** The current user, or null when signed out (never redirects). */
export async function currentUser(): Promise<Me | null> {
  try {
    return await api<Me>("/auth/me", { noAuthRedirect: true });
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
export async function findMyDocuments(displayName?: string): Promise<Collection | null> {
  return pickMyDocuments(await api<Collection[]>("/collections?limit=500"), displayName);
}

const isNameTaken = (e: unknown) => e instanceof ApiError && e.status === 409;

async function createCollection(name: string): Promise<Collection> {
  return api<Collection>("/collections", {
    method: "POST",
    json: { name, description: "Files added from the Ask page." },
  });
}

/** A writable "My documents" collection, created on first use. Names are unique per tenant, so
 *  when "My documents" exists but isn't writable for this user, "My documents · {display_name}"
 *  is used instead. Pass the display name when known to save a /auth/me round trip. */
export async function ensureMyDocuments(displayName?: string): Promise<Collection> {
  const existing = await findMyDocuments(displayName);
  if (existing) return existing;
  try {
    return await createCollection(MY_DOCUMENTS);
  } catch (e) {
    if (!isNameTaken(e)) throw e;
  }
  const name = displayName ?? (await api<Me>("/auth/me")).display_name;
  // Another tab may have just created "My documents", or the personal copy already exists.
  const again = await findMyDocuments(name);
  if (again) return again;
  try {
    return await createCollection(personalCollectionName(name));
  } catch (e) {
    const raced = isNameTaken(e) ? await findMyDocuments(name) : null;
    if (raced) return raced;
    throw e;
  }
}

/** Upload files into "My documents" and return the per-file results, in input order. Large
 *  batches go as several requests (requestGroups); progress covers all of them. */
export async function uploadToMyDocuments(
  files: File[],
  onProgress: (fraction: number) => void,
  displayName?: string,
): Promise<{ collection: Collection; items: UploadItem[] }> {
  const collection = await ensureMyDocuments(displayName);
  const totalBytes = files.reduce((n, f) => n + f.size, 0) || 1;
  const items: UploadItem[] = [];
  let doneBytes = 0;
  for (const group of requestGroups(files, (f) => f.size)) {
    const groupBytes = group.reduce((n, f) => n + f.size, 0);
    const res = await uploadFiles<{ items: UploadItem[] }>(
      `/collections/${collection.id}/documents`,
      group,
      (p) => onProgress(Math.min(1, (doneBytes + p * groupBytes) / totalBytes)),
    );
    items.push(...res.items);
    doneBytes += groupBytes;
  }
  return { collection, items };
}
