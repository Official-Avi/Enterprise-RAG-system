"use client";

import Link from "next/link";
import { useContext, useEffect, useId, useState, type ReactNode } from "react";
import { personaFor, ROLE_LABEL } from "@/lib/demo";
import { MeContext } from "@/lib/hooks";
import { PERMISSION_COPY } from "@/lib/permissionCopy";
import type { DemoPersona, Me } from "@/lib/types";
import { fetchDemoInfo } from "@/lib/workspace";
import { Icon } from "./icons";
import { cx } from "./ui";

/** Permission gate (§2.3, §7 #4): fallback "hide" renders nothing; "explain" renders NoAccess.
 *  Outside the authenticated shell (no MeContext) the permission counts as missing. */
export function Can(props: { permission: string; fallback?: "hide" | "explain"; page?: string; children: ReactNode }) {
  const { permission, fallback = "hide", page, children } = props;
  const me = useContext(MeContext);
  if (me?.permissions.includes(permission)) return <>{children}</>;
  if (fallback === "hide") return null;
  return <NoAccess page={page ?? PERMISSION_COPY[permission]?.page ?? "This page"} permission={permission} />;
}

/** The demo persona this user is signed in as, or null (also while loading or on error). */
function useDemoPersona(me: Me | null): DemoPersona | null {
  const [persona, setPersona] = useState<DemoPersona | null>(null);
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    fetchDemoInfo()
      .then((info) => {
        if (!cancelled) setPersona(personaFor(me, info));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me]);
  return me ? persona : null;
}

const linkBase =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-4 text-sm font-medium " +
  "transition-colors sm:min-h-9";
const linkPrimary = "border-transparent bg-accent text-accent-contrast hover:opacity-90";
const linkSecondary = "border-border-strong bg-panel text-text hover:bg-panel-2";

function ArrowLeft() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

/** Role-aware "needs a different role" page body (§7 #4). A plain region with an h1, never an
 *  alert: the page loaded fine, it just isn't for this role. */
export function NoAccess({ page, permission }: { page: string; permission?: string }) {
  const me = useContext(MeContext);
  const persona = useDemoPersona(me);
  const headingId = useId();
  const roles = permission ? PERMISSION_COPY[permission]?.roles : undefined;
  const can = (p: string) => !!me?.permissions.includes(p);

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex max-w-lg flex-col items-center px-4 py-12 text-center"
    >
      <span className="mb-4 grid size-12 place-items-center rounded-full bg-panel-2 text-muted">
        <Icon name="lock" width={22} height={22} />
      </span>
      <h1 id={headingId} className="text-xl font-semibold tracking-tight text-text">
        {page} needs a different role
      </h1>
      <p className="mt-2 text-sm text-muted">
        {me && (
          <>
            You&apos;re signed in as {me.display_name} ({ROLE_LABEL[me.role] ?? me.role}).{" "}
          </>
        )}
        {roles ? `${page} is for ${roles}.` : `${page} isn't available to your role.`}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {can("chat:use") ? (
          <Link href="/ask" className={cx(linkBase, linkPrimary)}>
            <ArrowLeft /> Back to Ask
          </Link>
        ) : can("ops:read") ? (
          <Link href="/overview" className={cx(linkBase, linkPrimary)}>
            Go to Overview <Icon name="arrowRight" />
          </Link>
        ) : (
          !me && (
            <Link href="/" className={cx(linkBase, linkSecondary)}>
              Back to home
            </Link>
          )
        )}
        {persona && (
          <Link href="/#demo" className={cx(linkBase, linkSecondary)}>
            Switch persona
          </Link>
        )}
      </div>
    </section>
  );
}
