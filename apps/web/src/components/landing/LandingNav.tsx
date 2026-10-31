"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { homePath } from "@/components/Shell";
import { cx } from "@/components/ui";
import { useVisitor } from "./Visitor";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "Questions" },
];

const pill =
  "inline-flex h-10 shrink-0 items-center rounded-full bg-accent px-3.5 text-sm font-semibold text-accent-contrast " +
  "transition-colors duration-150 hover:bg-accent/90 sm:px-4";

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

/** Renders its children when demo mode is on. With `optimistic` it also renders them while that
 *  isn't known yet (first check in flight, or the server unreachable, where the cards offer a
 *  retry), so the static page doesn't jump in the common demo-on case. */
export function DemoOnly({ children, optimistic = true }: { children: ReactNode; optimistic?: boolean }) {
  const { ready, demo, unreachable } = useVisitor();
  const show = demo?.enabled === true || (optimistic && (!ready || unreachable));
  return show ? <>{children}</> : null;
}

export function LandingNav() {
  const { ready, me, demo } = useVisitor();
  const scrolled = useScrolled();

  return (
    <header
      className={cx(
        "sticky top-0 z-30 border-b bg-landing-bg/90 backdrop-blur transition-colors duration-150",
        scrolled ? "border-border" : "border-transparent",
      )}
    >
      <nav
        aria-label="Site"
        className="mx-auto grid h-14 max-w-[1152px] grid-cols-[1fr_auto] items-center gap-3 px-4 md:grid-cols-[1fr_auto_1fr]"
      >
        <Link href="/" className="flex min-w-0 items-center gap-2 justify-self-start text-base font-semibold">
          <span className="inline-flex shrink-0 rounded-full dark:ring-1 dark:ring-border-strong">
            <Logo size={32} />
          </span>
          <span className="truncate max-[359px]:sr-only">RackFlow AI</span>
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-muted transition-colors duration-150 hover:text-text"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1 justify-self-end sm:gap-2">
          {!ready ? (
            <span aria-hidden="true" className="h-10" />
          ) : me ? (
            <Link href={homePath(me.permissions)} className={pill}>
              Open workspace
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="inline-flex h-10 shrink-0 items-center rounded-lg px-2.5 text-sm font-medium transition-colors duration-150 hover:bg-panel-2 sm:px-3"
              >
                Sign in
              </Link>
              {demo?.enabled && (
                <a href="#demo" className={pill}>
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
