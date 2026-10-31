"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { announce } from "@/lib/announce";
import { Sheet } from "../Sheet";
import { Button, cx } from "../ui";
import type { ScopeCollection, ScopeValue } from "./types";

const TITLE = "Choose what to search";
const AT_LEAST_ONE = "Pick at least one collection";
const SEARCH_THRESHOLD = 8;
const ALL = "\u0000all";
const NARROW_QUERY = "(max-width: 639.98px)";

function plural(n: number, word: string): string {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

function subscribeNarrow(onChange: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Below the sm breakpoint the picker is a bottom sheet instead of a popover (§10). */
function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

/** Ids being searched, limited to collections we know about. "all" expands to every one. */
function selectedIds(collections: ScopeCollection[], value: ScopeValue): Set<string> {
  if (value === "all") return new Set(collections.map((c) => c.id));
  const wanted = new Set(value);
  return new Set(collections.filter((c) => wanted.has(c.id)).map((c) => c.id));
}

interface Summary {
  narrowed: boolean;
  name: string;
  /** Ready documents in scope; null while the chosen collections aren't loaded. */
  docs: number | null;
}

function summarize(collections: ScopeCollection[], value: ScopeValue): Summary {
  const ids = selectedIds(collections, value);
  const chosen = collections.filter((c) => ids.has(c.id));
  const docs = chosen.reduce((n, c) => n + c.readyCount, 0);
  if (value === "all" || value.length === 0 || (chosen.length > 0 && chosen.length === collections.length)) {
    return { narrowed: false, name: "All documents", docs };
  }
  if (chosen.length === 0) {
    // Collections still loading (or no longer readable): show what was asked for, without a count.
    return { narrowed: true, name: plural(value.length, "collection"), docs: null };
  }
  return {
    narrowed: true,
    name: chosen.length === 1 ? chosen[0].name : plural(chosen.length, "collection"),
    docs,
  };
}

/** "Searching: All documents · 16" chip + "Choose what to search" picker (§5.8). */
export function ScopeChip({
  collections,
  value,
  onChange,
  readingCount,
}: {
  collections: ScopeCollection[];
  value: ScopeValue;
  onChange: (value: ScopeValue) => void;
  readingCount: number;
}) {
  const narrow = useNarrow();
  const [open, setOpen] = useState(false);
  // Remounts the sheet's picker on each open so the search box and note start fresh.
  const [openCount, setOpenCount] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const refocusChip = useRef(false);
  const dialogId = useId();
  const summary = summarize(collections, value);

  const show = () => {
    setOpen(true);
    setOpenCount((n) => n + 1);
  };
  const close = (refocus: boolean) => {
    refocusChip.current = refocus;
    setOpen(false);
  };

  // After Esc or Done, focus goes back to the chip once the popover/sheet is gone.
  useEffect(() => {
    if (open || !refocusChip.current) return;
    refocusChip.current = false;
    chipRef.current?.focus();
  }, [open]);

  // An outside click closes the popover without taking focus from whatever was clicked.
  useEffect(() => {
    if (!open || narrow) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, narrow]);

  const reading = readingCount > 0 ? `${readingCount} getting ready` : null;
  const accessibleName = [
    `Searching: ${summary.name}`,
    summary.docs !== null && plural(summary.docs, "document"),
    reading,
  ]
    .filter(Boolean)
    .join(", ");

  const popoverOpen = open && !narrow;

  return (
    <div
      ref={wrapRef}
      className="relative inline-flex min-w-0 max-w-full"
      onKeyDown={(e) => {
        if (e.key === "Escape" && popoverOpen) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={chipRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverOpen ? dialogId : undefined}
        aria-label={accessibleName}
        onClick={() => (open ? close(false) : show())}
        className={cx(
          "relative inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full border px-3",
          "text-sm font-medium transition-colors duration-150",
          // 44px hit area on touch while the chip stays 32px tall (§9 #9).
          "pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-1.5",
          "pointer-coarse:before:content-['']",
          summary.narrowed
            ? "border-accent bg-accent-soft text-accent hover:bg-accent-soft/80"
            : "border-border-strong bg-panel text-text hover:bg-panel-2",
        )}
      >
        <span className="min-w-0 truncate">Searching: {summary.name}</span>
        {summary.docs !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 tabular-nums">{summary.docs}</span>
          </>
        )}
        {reading && (
          <>
            <span aria-hidden="true">·</span>
            <Spinner />
            <span className="shrink-0 whitespace-nowrap tabular-nums">{reading}</span>
          </>
        )}
        <Chevron />
      </button>

      {popoverOpen && (
        <div
          id={dialogId}
          role="dialog"
          aria-label={TITLE}
          tabIndex={-1}
          onBlur={(e) => {
            // Tabbing out of the popover closes it; it is not a focus trap.
            const next = e.relatedTarget;
            if (next instanceof Node && !wrapRef.current?.contains(next)) setOpen(false);
          }}
          className={cx(
            "absolute bottom-full left-0 z-30 mb-2 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col",
            "overflow-hidden rounded-xl border border-border bg-panel text-text shadow-elev-3 outline-none",
            "transition-[opacity,translate] duration-200 ease-[var(--ease-snappy)]",
            "starting:opacity-0 motion-safe:starting:translate-y-1",
          )}
        >
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold">{TITLE}</h2>
          </div>
          <ScopePicker
            collections={collections}
            value={value}
            onChange={onChange}
            onDone={() => close(true)}
            autoFocus
          />
        </div>
      )}

      {narrow && (
        <Sheet
          open={open}
          onClose={() => {
            if (open) close(true);
          }}
          title={TITLE}
          side="bottom"
        >
          <ScopePicker
            key={openCount}
            collections={collections}
            value={value}
            onChange={onChange}
            onDone={() => close(true)}
          />
        </Sheet>
      )}
    </div>
  );
}

function ScopePicker({
  collections,
  value,
  onChange,
  onDone,
  autoFocus = false,
}: {
  collections: ScopeCollection[];
  value: ScopeValue;
  onChange: (value: ScopeValue) => void;
  onDone: () => void;
  /** Desktop only: mobile never autofocuses (§10). */
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  // The row whose checkbox was the last one checked when the user tried to clear it.
  const [blocked, setBlocked] = useState<string | null>(null);
  const allRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const baseId = useId();

  const ids = selectedIds(collections, value);
  const total = collections.reduce((n, c) => n + c.readyCount, 0);
  const chosenDocs = collections.reduce((n, c) => (ids.has(c.id) ? n + c.readyCount : n), 0);
  const allChecked = collections.length > 0 && ids.size === collections.length;
  const partial = ids.size > 0 && !allChecked;
  const showSearch = collections.length > SEARCH_THRESHOLD;
  const q = query.trim().toLowerCase();
  const visible = q ? collections.filter((c) => c.name.toLowerCase().includes(q)) : collections;

  // `indeterminate` is a DOM property only; sync it on every render.
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = partial;
  });

  useEffect(() => {
    if (autoFocus) (searchRef.current ?? allRef.current)?.focus();
  }, [autoFocus]);

  const apply = (next: Set<string>) => {
    setBlocked(null);
    onChange(next.size === collections.length ? "all" : collections.filter((c) => next.has(c.id)).map((c) => c.id));
  };
  const block = (key: string) => {
    setBlocked(key);
    announce(AT_LEAST_ONE);
  };
  const toggle = (id: string, checked: boolean) => {
    const next = new Set(ids);
    if (checked) next.add(id);
    else next.delete(id);
    if (next.size === 0) block(id);
    else apply(next);
  };
  const toggleAll = () => {
    if (allChecked) block(ALL);
    else apply(new Set(collections.map((c) => c.id)));
  };
  const only = (c: ScopeCollection) => {
    apply(new Set([c.id]));
    announce(`Searching ${plural(c.readyCount, "document")} in ${c.name}`);
  };

  const allLabelId = `${baseId}-all`;
  const allNoteId = `${baseId}-all-note`;

  return (
    <div className="flex min-h-0 flex-col">
      {showSearch && (
        <div className="px-4 pt-3">
          <label htmlFor={`${baseId}-search`} className="sr-only">
            Find a collection
          </label>
          <input
            ref={searchRef}
            id={`${baseId}-search`}
            type="search"
            value={query}
            autoComplete="off"
            placeholder="Find a collection"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // First Esc clears the search; the next one closes the picker.
              if (e.key === "Escape" && query) {
                e.preventDefault();
                e.stopPropagation();
                setQuery("");
              }
            }}
            className={cx(
              "h-9 w-full rounded-lg border border-border-strong bg-panel px-3 text-base text-text",
              "placeholder:text-muted sm:text-sm pointer-coarse:h-11",
            )}
          />
        </div>
      )}

      <div className="border-b border-border px-2 py-1">
        <label
          className={cx(
            "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5",
            "transition-colors duration-150 hover:bg-panel-2 pointer-coarse:min-h-12",
          )}
        >
          <input
            ref={allRef}
            type="checkbox"
            checked={allChecked}
            onChange={toggleAll}
            aria-labelledby={allLabelId}
            aria-describedby={blocked === ALL ? allNoteId : undefined}
            className="size-4 shrink-0 accent-accent"
          />
          <span className="min-w-0 flex-1">
            <span id={allLabelId} className="block text-sm font-medium">
              All documents <span className="tabular-nums">({total})</span>
            </span>
            {blocked === ALL && <AtLeastOneNote id={allNoteId} />}
          </span>
        </label>
      </div>

      <div className="max-h-[min(50vh,22rem)] overflow-y-auto px-2 py-1">
        {collections.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted">No collections to search yet.</p>
        ) : visible.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted">No collections match “{query.trim()}”.</p>
        ) : (
          <ul aria-label="Collections">
            {visible.map((c) => (
              <CollectionRow
                key={c.id}
                collection={c}
                checked={ids.has(c.id)}
                blocked={blocked === c.id}
                onToggle={(checked) => toggle(c.id, checked)}
                onOnly={() => only(c)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p className="min-w-0 text-xs text-muted tabular-nums">
          Searching {plural(chosenDocs, "document")} in {plural(ids.size, "collection")}
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={onDone}
          className="h-9 shrink-0 justify-center px-4 pointer-coarse:h-11"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function CollectionRow({
  collection,
  checked,
  blocked,
  onToggle,
  onOnly,
}: {
  collection: ScopeCollection;
  checked: boolean;
  blocked: boolean;
  onToggle: (checked: boolean) => void;
  onOnly: () => void;
}) {
  const id = useId();
  const meta = [
    plural(collection.readyCount, "document"),
    collection.pendingCount > 0 && `${collection.pendingCount} getting ready`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li
      className={cx(
        "group flex min-h-11 items-center gap-2 rounded-lg px-2",
        "transition-colors duration-150 hover:bg-panel-2 pointer-coarse:min-h-12",
      )}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 self-stretch py-1.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          aria-labelledby={`${id}-name`}
          aria-describedby={blocked ? `${id}-meta ${id}-note` : `${id}-meta`}
          className="size-4 shrink-0 accent-accent"
        />
        <span className="min-w-0 flex-1">
          <span id={`${id}-name`} className="block truncate text-sm font-medium">
            {collection.name}
          </span>
          <span id={`${id}-meta`} className="block text-xs text-muted tabular-nums">
            {meta}
          </span>
          {blocked && <AtLeastOneNote id={`${id}-note`} />}
        </span>
      </label>
      <button
        type="button"
        onClick={onOnly}
        aria-label={`Only ${collection.name}`}
        className={cx(
          "h-8 shrink-0 rounded-md px-2.5 text-xs font-medium text-accent hover:bg-accent-soft",
          "transition-[opacity,background-color] duration-150 pointer-coarse:h-11 pointer-coarse:px-3",
          // Revealed on row hover/focus where hover exists; always shown on touch (§10).
          "[@media(hover:hover)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        Only
      </button>
    </li>
  );
}

function AtLeastOneNote({ id }: { id: string }) {
  return (
    <span id={id} className="mt-0.5 flex items-center gap-1 text-xs font-medium text-warn">
      <span aria-hidden="true">!</span>
      {AT_LEAST_ONE}
    </span>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 shrink-0 motion-safe:animate-spin">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3.5 shrink-0 opacity-70">
      <path
        d="M5 6.5 8 3.5l3 3M5 9.5l3 3 3-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** §5.8 meta line under each answer: "Searched 9 documents in HR Policies, Safety". */
export function scopeLabel(collections: ScopeCollection[], value: ScopeValue): string {
  const ids = value === "all" || value.length === 0 ? null : value;
  const chosen = ids ? collections.filter((c) => ids.includes(c.id)) : collections;
  if (chosen.length === 0) {
    // The narrowed collections aren't loaded (or no longer readable): no names to show.
    return ids ? `Searched ${plural(ids.length, "collection")}` : "Searched all documents";
  }
  const docs = plural(chosen.reduce((n, c) => n + c.readyCount, 0), "document");
  if (!ids && chosen.length > 1) return `Searched ${docs} in all collections`;
  return `Searched ${docs} in ${chosen.map((c) => c.name).join(", ")}`;
}
