"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Logo } from "@/components/Logo";
import { Button, inputClass } from "@/components/ui";
import { api, ApiError } from "@/lib/api";

function safeNext(next: string | null): string {
  // Only allow same-site relative paths (no open redirects).
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", {
        method: "POST",
        json: {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          tenant_slug: String(form.get("workspace") ?? "") || undefined,
          mode: "cookie",
        },
      });
      router.replace(safeNext(params.get("next")));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-describedby={error ? "login-error" : undefined}>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Work email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="workspace" className="mb-1 block text-sm font-medium">
          Workspace <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id="workspace" name="workspace" placeholder="e.g. acme" className={inputClass} />
      </div>
      {error && (
        <p id="login-error" role="alert" className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-panel p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={48} />
          <div>
            <h1 className="font-semibold leading-tight">RackFlow AI</h1>
            <p className="text-xs text-muted">Enterprise RAG control plane</p>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
