"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { describeStatus } from "@/lib/status";
import { LOADING_FILENAME, MY_DOCUMENTS } from "@/lib/workspace";
import type { TrackedUpload } from "../types";

const NOTE_TONE = { info: "bg-info-soft", warn: "bg-warn-soft", bad: "bg-bad-soft" };

/** A dismissible line above the list. Announced by the caller, so it has no live role unless
 *  `alert` is set. */
export function NoteBar({
  tone,
  alert = false,
  action,
  onDismiss,
  children,
}: {
  tone: keyof typeof NOTE_TONE;
  alert?: boolean;
  action?: ReactNode;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cx(
        "mt-4 flex items-start gap-2 rounded-lg border border-border py-2 pr-1 pl-3 text-sm text-text",
        NOTE_TONE[tone],
      )}
    >
      <p className="min-w-0 flex-1 py-0.5 [overflow-wrap:anywhere]">{children}</p>
      {action}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss note"
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:text-text pointer-coarse:size-11"
      >
        <Icon name="close" width={14} height={14} />
      </button>
    </div>
  );
}

export interface UploadNote {
  id: string;
  text: string;
  tone: "info" | "bad";
  /** The upload rows this note speaks for; dismissing it covers all of them. */
  keys: string[];
  /** The files exist but the current search, status or collection hides them. */
  offerShowAll: boolean;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function duplicateText(rows: TrackedUpload[], originalName: (id: string | undefined) => string | undefined): string {
  if (rows.length > 1) return `${rows.length} files were already added. Using the copies you already have.`;
  const [row] = rows;
  const original = originalName(row.documentId);
  return original && original !== row.filename
    ? `${row.filename} has the same contents as ${original}. Using the copy you already have.`
    : `${row.filename} was already added. Using the copy you already have.`;
}

/** What the list itself can't show about uploads made while this page is open. A duplicate has no
 *  row of its own, and any other upload can be hidden by the current search, status or collection,
 *  so without these the file would look lost to anyone who can't hear the live region. */
export function useUploadNotes({
  items,
  rowKeys,
  removedIds,
  originalName,
  collectionName,
}: {
  items: TrackedUpload[];
  /** The keys of the rows on screen right now. */
  rowKeys: ReadonlySet<string>;
  removedIds: ReadonlySet<string>;
  originalName: (id: string | undefined) => string | undefined;
  collectionName: string | undefined;
}) {
  // Finished uploads from before this page opened, then rows dismissed or already seen in the list.
  const [handled, setHandled] = useState<ReadonlySet<string>>(
    () => new Set(items.filter((u) => u.phase !== "uploading").map((u) => u.key)),
  );

  // A duplicate of a file that isn't Ready follows its copy's phase, so remember which ones matched:
  // the row on screen is still the original, under its own name.
  const [matched, setMatched] = useState<ReadonlySet<string>>(() => new Set());
  const newlyMatched = items.filter((u) => u.phase === "duplicate" && !matched.has(u.key));
  if (newlyMatched.length) setMatched(new Set([...matched, ...newlyMatched.map((u) => u.key)]));
  const isDuplicate = (u: TrackedUpload) => u.phase === "duplicate" || matched.has(u.key);

  // Remember what each duplicate matched: a search can hide that row while the note is still up.
  const [originals, setOriginals] = useState<ReadonlyMap<string, string>>(() => new Map());
  const foundOriginals = items.flatMap((u) => {
    const id = u.documentId;
    const name = id && isDuplicate(u) && !originals.has(id) ? originalName(id) : undefined;
    return id && name ? [[id, name] as const] : [];
  });
  if (foundOriginals.length) setOriginals(new Map([...originals, ...foundOriginals]));

  const open = items.filter((u) => !handled.has(u.key) && u.filename !== LOADING_FILENAME);
  const listed = open.filter((u) => !isDuplicate(u) && rowKeys.has(u.documentId ?? u.key));
  // Once a file has shown up in the list, later filter changes shouldn't report it as hidden. An
  // upload still in progress doesn't count yet: its row can turn out to be a duplicate.
  const settledInList = listed.filter((u) => u.phase !== "uploading");
  if (settledInList.length) setHandled(new Set([...handled, ...settledInList.map((u) => u.key)]));

  const pending = open.filter((u) => !listed.includes(u));
  const duplicates = pending.filter((u) => isDuplicate(u) && !(u.documentId && removedIds.has(u.documentId)));
  const rejected = pending.filter((u) => !isDuplicate(u) && u.phase === "rejected");
  const accepted = pending.filter((u) => !isDuplicate(u) && u.phase !== "rejected" && u.phase !== "deleting");

  const notes: UploadNote[] = [];
  if (duplicates.length) {
    notes.push({
      id: "duplicate",
      text: duplicateText(duplicates, (id) => (id ? (originals.get(id) ?? originalName(id)) : undefined)),
      tone: "info",
      keys: duplicates.map((u) => u.key),
      // The copy it matched can itself be hidden by the current search, status or collection.
      offerShowAll: duplicates.some((u) => !rowKeys.has(u.documentId ?? u.key)),
    });
  }
  if (rejected.length) {
    const [first] = rejected;
    notes.push({
      id: "rejected",
      text:
        rejected.length === 1
          ? `${first.filename} wasn't accepted. ${describeStatus("rejected", first).sub ?? ""}`.trim()
          : `${rejected.length} files weren't accepted. Show all files to see why.`,
      tone: "bad",
      keys: rejected.map((u) => u.key),
      offerShowAll: true,
    });
  }
  if (accepted.length) {
    const where = collectionName ?? MY_DOCUMENTS;
    // Not "added" until the server has it: an upload can still be rejected or cancelled.
    const arriving = accepted.some((u) => u.phase === "uploading");
    const verb = arriving ? plural(accepted.length, "is being", "are being") : plural(accepted.length, "was", "were");
    notes.push({
      id: "hidden",
      text: `${accepted.length === 1 ? accepted[0].filename : `${accepted.length} files`} ${verb} added to ${where}. ${plural(accepted.length, "It isn't", "They aren't")} in this view.`,
      tone: "info",
      keys: accepted.map((u) => u.key),
      offerShowAll: true,
    });
  }

  return {
    notes,
    /** Documents a duplicate upload pointed at, so their rows can flash. */
    duplicateIds: duplicates.flatMap((u) => (u.documentId ? [u.documentId] : [])),
    dismiss: (note: UploadNote) => setHandled(new Set([...handled, ...note.keys])),
  };
}
