"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { DemoPersonaCards } from "@/components/landing/DemoPersonaCards";
import { signedInPath, useVisitor, VisitorProvider } from "@/components/landing/Visitor";
import { Logo } from "@/components/Logo";
import { cx } from "@/components/ui";
import { announce } from "@/lib/announce";
import { api, ApiError } from "@/lib/api";
import { usePending } from "@/lib/pendingStore";
import type { Me } from "@/lib/types";

// 44px on touch, 40px with a fine pointer. Hover darkens the edge; an error turns it red.
const fieldClass =
  "block h-11 w-full rounded-input border border-border-strong bg-panel px-3 text-base text-text " +
  "pointer-fine:h-10 pointer-fine:sm:text-sm placeholder:text-muted " +
  "transition-colors duration-[var(--dur-micro)] hover:border-text-2 " +
  "focus-visible:border-accent disabled:cursor-not-allowed disabled:bg-panel-2 disabled:opacity-55 aria-[invalid=true]:border-bad";

const labelClass = "mb-2 block text-sm font-medium text-text";

function loginError(e: unknown): string {
  if (!(e instanceof ApiError)) return "Sign-in failed.";
  if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
  if (e.status === 0 || e.status >= 500) return "Can't reach RackFlow. Check that the server is running.";
  return e.message;
}

function DemoBlock() {
  const { ready, demo, unreachable } = useVisitor();
  // While loading, and when the server can't be reached, the cards show their skeletons or notice.
  if (ready && !unreachable && (!demo?.enabled || demo.personas.length === 0)) return null;
  return (
    <section aria-labelledby="demo-heading" className="mb-10">
      <h2 id="demo-heading" className="mb-3 text-base text-text">
        Use a demo account
      </h2>
      <DemoPersonaCards variant="compact" />
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
    <p className="mb-6 flex items-start gap-2 rounded-md bg-accent-soft px-3 py-2 text-sm text-text">
      <Icon name="lock" className="mt-0.5 shrink-0 text-accent" />
      <span>Your {what} in this tab until you sign in.</span>
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
      router.replace(signedInPath(params.get("next"), me.permissions));
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
    <form onSubmit={submit} aria-label="Sign in with email" className="space-y-6">
      <div>
        <label htmlFor="email" className={labelClass}>
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
        <label htmlFor="password" className={labelClass}>
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
              // A clear border keeps the fill inside the field's border while the target stays 44px tall.
              // The ring is drawn inside the field so the field's own edge doesn't cut through it.
              "absolute inset-y-0 right-0 inline-flex min-w-11 items-center justify-center rounded-r-input border",
              "border-transparent bg-clip-padding px-3 text-sm font-medium text-accent underline-offset-2",
              "transition-colors duration-[var(--dur-micro)] hover:bg-panel-2 hover:underline active:bg-panel-3",
              "focus-visible:outline-offset-[-3px]",
              "aria-pressed:bg-accent-soft aria-pressed:hover:bg-accent-soft",
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
          className={cx(
            "inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent underline-offset-2",
            "hover:underline active:text-accent-hover sm:min-h-8",
          )}
        >
          <Icon
            name="plus"
            width={14}
            height={14}
            className={cx("shrink-0 transition-transform duration-[var(--dur-micro)]", workspaceOpen && "rotate-45")}
          />
          Signing in to a specific workspace?
        </button>
        <div id="workspace-field" hidden={!workspaceOpen} className="mt-3">
          {workspaceOpen && (
            <>
              <label htmlFor="workspace" className={labelClass}>
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
              <p id="workspace-hint" className="mt-2 text-xs text-muted">
                Leave it blank to use your default workspace.
              </p>
            </>
          )}
        </div>
      </div>

      {error && (
        <p id="login-error" role="alert" className="flex items-start gap-2 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
          <Icon name="cross" className="mt-0.5 shrink-0" />
          <span>{error.text}</span>
        </p>
      )}

      <button
        type="submit"
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        className="key key-primary min-h-11 w-full pointer-fine:min-h-10 aria-busy:cursor-progress aria-busy:opacity-80"
      >
        {busy && (
          <span aria-hidden="true" className="size-4 motion-safe:animate-spin rounded-full border-2 border-current border-r-transparent" />
        )}
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

function FormFallback() {
  return (
    <div aria-hidden="true" className="space-y-6">
      {[0, 1].map((i) => (
        <div key={i}>
          <div className="mb-2 h-5 w-24 motion-safe:animate-shimmer rounded-sm bg-panel-3" />
          <div className="h-11 motion-safe:animate-shimmer rounded-input bg-panel-3 pointer-fine:h-10" />
        </div>
      ))}
      <div className="h-6 w-56 motion-safe:animate-shimmer rounded-sm bg-panel-3" />
      <div className="h-11 motion-safe:animate-shimmer rounded-input bg-panel-3 pointer-fine:h-10" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <main id="main" className="flex min-h-dvh justify-center bg-bg px-4 py-10 sm:items-center sm:px-6 sm:py-16">
      <div className="w-full max-w-[28rem]">
        <header className="mb-10 border-b border-border pb-6">
          <Logo size={36} />
          <h1 className="mt-4 text-2xl text-text">RackFlow AI</h1>
          <p className="mt-1 text-base text-text-2">Ask questions about your documents</p>
        </header>
        <ResumeNote />
        <VisitorProvider>
          <DemoBlock />
        </VisitorProvider>
        <h2 className="mb-3 text-sm font-medium text-text">Sign in with email</h2>
        {/* The one panel on the page. The demo rows sit on the ground, so no card holds another. */}
        <div className="cut border border-border bg-panel p-6 shadow-elev-1">
          <Suspense fallback={<FormFallback />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
