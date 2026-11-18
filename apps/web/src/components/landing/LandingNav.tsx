"use client";

import Link from "next/link";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { homePath } from "@/components/Shell";
import { cx } from "@/components/ui";
import type { DemoInfo } from "@/lib/types";
import { useVisitor } from "./Visitor";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "Questions" },
];

/** The bar's one primary key (design.md: keycaps, one cobalt key per view), 44px on touch. */
const primaryKey = "key key-primary shrink-0 max-sm:min-h-11 max-sm:px-3";

/** Nav links: body face, secondary ink, ink on hover and keyboard focus, 44px tall. */
const navLink =
  "inline-flex min-h-11 shrink-0 items-center rounded-input px-3 text-sm font-medium text-text-2 " +
  "transition-colors duration-(--dur-micro) hover:text-text focus-visible:text-text active:text-accent";

function subscribeScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

/** True once the page has scrolled past 8px; the bar gains its border then (§3.0). */
function useScrolled(): boolean {
  return useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > 8,
    () => false,
  );
}

/** Demo mode is on and has at least one account to offer. */
function hasDemoAccounts(demo: DemoInfo | null): boolean {
  return demo?.enabled === true && demo.personas.length > 0;
}

/** Renders its children when demo mode has accounts to offer. With `optimistic` it also renders them while that
 *  isn't known yet (first check in flight, or the server unreachable, where the cards offer a
 *  retry), so the static page doesn't jump in the common demo-on case. */
export function DemoOnly({ children, optimistic = true }: { children: ReactNode; optimistic?: boolean }) {
  const { ready, demo, unreachable } = useVisitor();
  const show = hasDemoAccounts(demo) || (optimistic && (!ready || unreachable));
  return show ? <>{children}</> : null;
}

/** Opens a <details> when a link points at it or the page loads on its hash (§3.8). Opening on the
 *  click, ahead of the browser's own jump, means the scroll accounts for the expanded answer. */
export function OpenDetailsOnHash() {
  useEffect(() => {
    const open = (hash: string) => {
      const target = hash.length > 1 ? document.getElementById(hash.slice(1)) : null;
      if (target instanceof HTMLDetailsElement) target.open = true;
    };
    const onClick = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
      if (link) open(link.getAttribute("href") ?? "");
    };
    const onHashChange = () => open(window.location.hash);
    onHashChange();
    document.addEventListener("click", onClick);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);
  return null;
}

export function LandingNav() {
  const { ready, me, demo } = useVisitor();
  const scrolled = useScrolled();

  return (
    <header
      className={cx(
        "sticky top-0 z-(--z-sticky-nav) h-16 border-b backdrop-blur transition-[background-color,border-color] duration-(--dur-short) [@media(max-height:500px)]:h-12",
        scrolled ? "border-border bg-landing-bg/90" : "border-transparent bg-landing-bg",
      )}
    >
      <nav
        aria-label="Site"
        className="mx-auto flex h-full w-full max-w-(--container) items-center justify-between gap-3 px-(--gutter)"
      >
        <Link
          href="/"
          className="-mx-1 flex min-h-11 min-w-0 items-center gap-2 rounded-input px-1 font-display text-lg font-semibold text-text transition-colors duration-(--dur-micro) hover:text-text-2 focus-visible:text-text active:text-accent"
        >
          <span className="inline-flex shrink-0 rounded-full dark:ring-1 dark:ring-border-strong">
            <Logo size={32} />
          </span>
          <span className="truncate max-[359px]:sr-only">RackFlow AI</span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <ul className="hidden items-center md:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className={navLink}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <span aria-hidden="true" className="mx-2 hidden h-5 w-px bg-border-2 md:block" />
          {!ready ? (
            <span aria-hidden="true" className="h-10" />
          ) : me ? (
            <Link href={homePath(me.permissions)} className={primaryKey}>
              Open workspace
            </Link>
          ) : (
            <>
              <Link href="/login" className={navLink}>
                Sign in
              </Link>
              {hasDemoAccounts(demo) && (
                <a href="#demo" className={primaryKey}>
                  Try a demo
                </a>
              )}
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
