"use client";

import { useId, type Ref } from "react";
import { cx } from "@/components/ui";
import { SearchIcon } from "./parts";
import { FILTERS, type StatusFilter } from "./rows";

const CONTROL =
  "h-9 w-full rounded-lg border border-border-strong bg-panel text-base text-text transition-colors duration-150 " +
  "pointer-coarse:h-11";

/** §6 toolbar: name search (16px text so iOS doesn't zoom), status chips with counts and the
 *  collection menu. Chips other than All hide at 0 unless selected, so the selected filter's
 *  empty state stays reachable. */
export function LibraryToolbar({
  query,
  onQuery,
  searchRef,
  filter,
  onFilter,
  counts,
  collections,
  collectionId,
  onCollection,
}: {
  query: string;
  onQuery: (value: string) => void;
  searchRef: Ref<HTMLInputElement>;
  filter: StatusFilter;
  onFilter: (filter: StatusFilter) => void;
  counts: Record<StatusFilter, number>;
  /** Readable collections; the menu is hidden until they load. */
  collections: { id: string; name: string }[];
  collectionId: string;
  onCollection: (id: string) => void;
}) {
  const selectId = useId();
  const chips = FILTERS.filter((f) => f.key === "all" || f.key === filter || counts[f.key] > 0);

  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1 sm:max-w-[360px]">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search by file name"
            aria-label="Search by file name"
            maxLength={200}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            className={cx(CONTROL, "pr-3 pl-9 placeholder:text-muted")}
          />
        </div>
        {collections.length > 0 && (
          <div className="sm:w-60">
            <label htmlFor={selectId} className="sr-only">
              Collection
            </label>
            <select
              id={selectId}
              value={collectionId}
              onChange={(e) => onCollection(e.target.value)}
              className={cx(CONTROL, "px-3")}
            >
              <option value="all">All collections</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {chips.map((f) => {
          const active = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => onFilter(f.key)}
              className={cx(
                "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium",
                "transition-colors duration-150 pointer-coarse:h-11",
                active
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border-strong bg-panel text-text hover:bg-panel-2",
              )}
            >
              {f.label}
              <span className={cx("tabular-nums", active ? "text-accent" : "text-muted")}>{counts[f.key]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
