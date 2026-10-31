"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { DemoPersonaCards } from "@/components/landing/DemoPersonaCards";
import { useVisitor, VisitorProvider } from "@/components/landing/Visitor";
import { Logo } from "@/components/Logo";
import { homePath } from "@/components/Shell";
import { cx } from "@/components/ui";
import { announce } from "@/lib/announce";
import { api, ApiError } from "@/lib/api";
import { usePending } from "@/lib/pendingStore";
import type { Me } from "@/lib/types";

const fieldClass =
  "block h-11 w-full rounded-lg border border-border-strong bg-panel px-3 text-base text-text " +
  "placeholder:text-muted transition-colors duration-150 aria-[invalid=true]:border-bad";

function safeNext(next: string | null): string | null {
  // Only allow same-site relative paths (no open redirects). Browsers read "/\host" and
  // "/<tab>/host" as "//host", so the parsed origin is checked as well as the prefix.
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname.startsWith("/login")) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** §2.2: honour ?next= only for a route the role can open. The console gates its own pages. */
function canOpen(path: string, permissions: string[]): boolean {
  const has = (p: string) => permissions.includes(p);
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
  if (under("/ask") || under("/chat")) return has("chat:use");
  if (under("/library")) return has("collection:read") && (has("chat:use") || has("document:upload"));
  return true;
}

function destination(next: string | null, permissions: string[]): string {
  const safe = safeNext(next);
  return safe && canOpen(safe, permissions) ? safe : homePath(permissions);
}

function loginError(e: unknown): string {
  if (!(e instanceof ApiError)) return "Sign-in failed.";
  if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (e.status === 0 || e.status >= 500) return "Can't reach RackFlow. Check that the server is running.";
  return e.message;
}

function DemoBlock() {
  const { ready, demo } = useVisitor();
  if (!ready) {
    // Reserve the block's height so the email form does not jump once demo info arrives.
    return (
      <div aria-hidden="true" className="mb-6 space-y-3">
        <div className="h-5 w-40 rounded bg-panel-2" />
        <div className="h-[248px] animate-pulse rounded-xl bg-panel-2 motion-reduce:animate-none" />
        <div className="h-5" />
      </div>
    );
  }
  if (!demo?.enabled || demo.personas.length === 0) return null;
  return (
    <section aria-labelledby="demo-heading" className="mb-6">
      <h2 id="demo-heading" className="mb-3 text-sm font-semibold">
        Use a demo account
      </h2>
      <DemoPersonaCards variant="compact" />
      <div className="mt-6 flex items-center gap-3 text-xs font-medium text-muted">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span>or sign in with email</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    </section>
  );
}

/** Reassurance when the visitor was sent here mid-task (a dropped file or typed question). */
function ResumeNote() {
  const pending = usePending();
  const n = pending.files.length;
  if (n === 0 && !pending.question) return null;
  const what = n > 1 ? "files stay" : n === 1 ? "file stays" : "question stays";
  return (
    <p className="mb-6 rounded-lg bg-accent-soft px-3 py-2 text-sm text-text">
      Your {what} in this tab until you sign in.
    </p>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<{ text: string; invalid: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (workspaceOpen) workspaceRef.current?.focus();
  }, [workspaceOpen]);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (busy) return;
    const form = new FormData(ev.currentTarget);
    setBusy(true);
    setError(null);
    // Back to a masked field so browsers offer to save the password.
    setShowPassword(false);
    try {
      const me = await api<Me>("/auth/login", {
        method: "POST",
        json: {
          email: String(form.get("email") ?? "").trim(),
          password: String(form.get("password") ?? ""),
          tenant_slug: String(form.get("workspace") ?? "").trim() || undefined,
          mode: "cookie",
        },
      });
      announce(`Signed in as ${me.display_name}`);
      // With resume=1 the pending file or question stays in pendingStore; /ask takes it.
      router.replace(destination(params.get("next"), me.permissions));
    } catch (e) {
      const invalid = e instanceof ApiError && e.status === 401;
      setError({ text: loginError(e), invalid });
      setBusy(false);
      if (invalid) {
        passwordRef.current?.focus();
        passwordRef.current?.select();
      }
    }
  };

  const invalid = error?.invalid ? true : undefined;
  const describedBy = error ? "login-error" : undefined;

  return (
    <form onSubmit={submit} aria-label="Sign in with email" className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={fieldClass}
        />
      </div>
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
          Password
        </label>
        <div className="relative">
          <input
            ref={passwordRef}
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={cx(fieldClass, "pr-20")}
          />
          <button
            type="button"
            aria-pressed={showPassword}
            aria-controls="password"
            aria-label="Show password"
            onClick={() => setShowPassword((s) => !s)}
            className={cx(
              "absolute inset-y-px right-px inline-flex min-w-11 items-center justify-center rounded-r-lg px-3",
              "text-sm font-medium text-accent transition-colors duration-150 hover:bg-panel-2",
            )}
          >
            Show
          </button>
        </div>
      </div>

      <div>
        <button
          type="button"
          aria-expanded={workspaceOpen}
          aria-controls="workspace-field"
          onClick={() => setWorkspaceOpen((o) => !o)}
          className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-2 hover:underline sm:min-h-8"
        >
          Signing in to a specific workspace?
        </button>
        <div id="workspace-field" hidden={!workspaceOpen} className="mt-2">
          {workspaceOpen && (
            <>
              <label htmlFor="workspace" className="mb-1.5 block text-sm font-medium">
                Workspace
              </label>
              <input
                ref={workspaceRef}
                id="workspace"
                name="workspace"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="e.g. acme"
                aria-describedby="workspace-hint"
                className={fieldClass}
              />
              <p id="workspace-hint" className="mt-1.5 text-xs text-muted">
                Leave it blank to use your default workspace.
              </p>
            </>
          )}
        </div>
      </div>

      {error && (
        <p id="login-error" role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
          {error.text}
        </p>
      )}

      <button
        type="submit"
        aria-disabled={busy || undefined}
        className={cx(
          "inline-flex h-11 w-full items-center justify-center rounded-lg bg-accent px-4 text-[15px] font-medium",
          "text-accent-contrast transition-[opacity,scale] duration-150 hover:opacity-90 active:scale-[0.98]",
          "aria-disabled:cursor-wait aria-disabled:opacity-70",
        )}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

function FormFallback() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="h-[70px] rounded-lg bg-panel-2" />
      <div className="h-[70px] rounded-lg bg-panel-2" />
      <div className="h-8" />
      <div className="h-11 rounded-lg bg-panel-2" />
    </div>
  );
}

export default function LoginPage() {
  useEffect(() => {
    document.title = "Sign in · RackFlow AI";
  }, []);

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-[440px] rounded-2xl border border-border bg-panel p-6 sm:p-8">
        <header className="mb-6 flex items-center gap-3">
          <Logo size={40} />
          <div className="min-w-0">
            <h1 className="text-xl leading-7 font-semibold">RackFlow AI</h1>
            <p className="text-sm text-muted">Ask questions about your documents</p>
          </div>
        </header>
        <ResumeNote />
        <VisitorProvider>
          <DemoBlock />
        </VisitorProvider>
        <Suspense fallback={<FormFallback />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
