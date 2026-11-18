"use client";

import { useId, type Ref } from "react";
import { cx } from "@/components/ui";
import { SearchIcon } from "./parts";
import { FILTERS, type StatusFilter } from "./rows";

// design.md, Inputs: panel face, the 3:1 border, 40px (44 on touch), hover deepens the edge.
const CONTROL =
  "h-10 w-full rounded-input border border-border-strong bg-panel text-sm text-text " +
  "transition-colors duration-[var(--dur-micro)] hover:border-text-2 focus-visible:outline-offset-[-1px] " +
  "pointer-coarse:h-11";

/** §6 toolbar: name search (16px text so iOS doesn't zoom), status chips with counts and the
 *  collection menu. Only Needs attention hides at 0, and not while it is selected, so its empty
 *  state stays reachable. */
export function LibraryToolbar({
  query,
  onQuery,
  searchRef,
  filter,
  onFilter,
  counts,
  atLeast,
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
  /** Chips whose count is only a lower bound, because the list stops at the newest 200. */
  atLeast: ReadonlySet<StatusFilter>;
  /** Readable collections; the menu is hidden until they load. */
  collections: { id: string; name: string }[];
  collectionId: string;
  onCollection: (id: string) => void;
}) {
  const selectId = useId();
  const chips = FILTERS.filter((f) => f.key !== "attention" || f.key === filter || counts.attention > 0);

  return (
    <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center lg:flex-1">
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
          <div className="sm:w-56">
            <label htmlFor={selectId} className="sr-only">
              Collection
            </label>
            <select
              id={selectId}
              value={collectionId}
              onChange={(e) => onCollection(e.target.value)}
              className={cx(CONTROL, "cursor-pointer px-3")}
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

      <div role="group" aria-label="Filter by status" className="tray max-w-full flex-wrap self-start lg:self-auto">
        {chips.map((f) => {
          const active = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => onFilter(f.key)}
              className={cx(
                "key min-h-8 gap-2 px-3 text-sm pointer-coarse:min-h-11",
                // Selected takes ScopeChip's recipe (accent-soft fill, accent ink and edge) on top of
                // the pressed key, so the choice carries a hue as well as depth in both modes.
                "aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent",
                !active && "text-text-2",
              )}
            >
              {f.label}
              <span className={cx("text-xs tabular-nums", active ? "text-current" : "text-muted")}>
                {counts[f.key]}
                {atLeast.has(f.key) ? "+" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
