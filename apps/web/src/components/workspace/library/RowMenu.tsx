"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cx } from "@/components/ui";
import { DotsIcon } from "./parts";

export interface RowAction {
  label: string;
  /** Receives the "⋯" trigger so the caller can return focus to it. */
  onSelect?: (trigger: HTMLButtonElement) => void;
  href?: string;
  /** A same-origin file download rather than a page link. */
  download?: boolean;
  danger?: boolean;
}

interface Position {
  top?: number;
  bottom?: number;
  right: number;
}

const ITEM =
  "flex min-h-10 w-full items-center rounded-lg px-3 text-left text-sm font-medium outline-none " +
  "transition-colors duration-150 hover:bg-panel-2 focus-visible:bg-panel-2 pointer-coarse:min-h-11";

/** "⋯" menu button (WAI-ARIA menu button). The menu is position:fixed so the table's
 *  overflow wrapper can't clip it, but stays next to its trigger in the DOM for Tab order. */
export function RowMenu({
  filename,
  actions,
  size = "md",
}: {
  filename: string;
  actions: RowAction[];
  size?: "md" | "lg";
}) {
  const [pos, setPos] = useState<Position | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = pos !== null;

  const show = () => {
    const el = trigger.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const height = actions.length * 44 + 10;
    const right = Math.max(8, window.innerWidth - r.right);
    const roomBelow = window.innerHeight - r.bottom;
    setPos(roomBelow < height && r.top > roomBelow ? { bottom: window.innerHeight - r.top + 4, right } : { top: r.bottom + 4, right });
  };

  const close = (refocus: boolean) => {
    setPos(null);
    if (refocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setPos(null);
    };
    const moved = (e: Event) => {
      if (!(e.target instanceof Node && menu.current?.contains(e.target))) setPos(null);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", moved, true);
    window.addEventListener("resize", moved);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", moved, true);
      window.removeEventListener("resize", moved);
    };
  }, [open]);

  if (actions.length === 0) return null;

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") {
      // Let focus move on to the next control first, then drop the menu.
      window.setTimeout(() => setPos(null), 0);
    }
  };

  const pick = (action: RowAction) => {
    const el = trigger.current;
    close(true);
    if (el) action.onSelect?.(el);
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={`Actions for ${filename}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            show();
          }
        }}
        className={cx(
          "inline-grid shrink-0 place-items-center rounded-lg text-muted transition-colors duration-150",
          "hover:bg-panel-2 hover:text-text aria-expanded:bg-panel-2 aria-expanded:text-text",
          size === "lg" ? "h-11 w-11" : "h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11",
        )}
      >
        <DotsIcon />
      </button>
      {pos && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={`Actions for ${filename}`}
          onKeyDown={onMenuKey}
          style={{ top: pos.top, bottom: pos.bottom, right: pos.right }}
          className={cx(
            "fixed z-40 min-w-48 rounded-xl border border-border bg-panel p-1 text-left shadow-elev-3",
            "transition-[opacity,translate] duration-200 ease-[var(--ease-snappy)]",
            "starting:opacity-0 motion-safe:starting:translate-y-1",
          )}
        >
          {actions.map((a) => {
            const cls = cx(ITEM, a.danger ? "text-bad" : "text-text");
            if (a.href && a.download) {
              return (
                <a
                  key={a.label}
                  role="menuitem"
                  tabIndex={-1}
                  href={a.href}
                  download
                  className={cls}
                  onClick={() => window.setTimeout(() => close(true), 0)}
                >
                  {a.label}
                </a>
              );
            }
            if (a.href) {
              return (
                <Link key={a.label} role="menuitem" tabIndex={-1} href={a.href} className={cls}>
                  {a.label}
                </Link>
              );
            }
            return (
              <button key={a.label} type="button" role="menuitem" tabIndex={-1} className={cls} onClick={() => pick(a)}>
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
