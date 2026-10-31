"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { cx } from "@/components/ui";
import { errorText } from "@/lib/api";
import type { Me } from "@/lib/types";
import { ACCEPT_ATTR, checkFile, MAX_FILES, uploadToMyDocuments } from "@/lib/workspace";
import { useVisitor } from "./Visitor";

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; label: string; progress?: number }
  | { kind: "error"; message: ReactNode };

/** The landing page's working tool: drop a file or type a question. Visitors who are not
 *  signed in are signed in as the demo Engineer first (when demo mode is on). */
export function HeroUpload() {
  const { me, demo, signInAs } = useVisitor();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "busy";

  const session = async (nextPath: string): Promise<Me | null> => {
    if (me) return me;
    if (demo?.enabled) {
      setPhase({ kind: "busy", label: "Opening the demo workspace…" });
      return signInAs("engineer");
    }
    setPhase({
      kind: "error",
      message: (
        <>
          Please{" "}
          <Link className="font-medium underline" href={`/login?next=${encodeURIComponent(nextPath)}`}>
            sign in
          </Link>{" "}
          first.
        </>
      ),
    });
    return null;
  };

  const addFiles = async (files: File[]) => {
    if (!files.length || busy) return;
    if (files.length > MAX_FILES) {
      setPhase({ kind: "error", message: `You can add up to ${MAX_FILES} files at once.` });
      return;
    }
    for (const f of files) {
      const problem = checkFile(f);
      if (problem) {
        setPhase({ kind: "error", message: `${f.name}: ${problem}` });
        return;
      }
    }
    try {
      const user = await session("/ask");
      if (!user) return;
      if (!user.permissions.includes("document:upload")) {
        setPhase({
          kind: "error",
          message: "This account can't add documents. Log in as the Engineer demo below to try uploading.",
        });
        return;
      }
      setPhase({ kind: "busy", label: "Uploading…", progress: 0 });
      const { items } = await uploadToMyDocuments(files, (p) =>
        setPhase({ kind: "busy", label: "Uploading…", progress: p }),
      );
      const ids = items.filter((i) => i.document_id).map((i) => i.document_id as string);
      if (!ids.length) {
        setPhase({ kind: "error", message: items[0]?.error?.message ?? "The file could not be added." });
        return;
      }
      setPhase({ kind: "busy", label: "Opening your workspace…" });
      router.push(`/ask?docs=${ids.join(",")}`);
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e) });
    }
  };

  const ask = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const q = String(new FormData(ev.currentTarget).get("q") ?? "").trim();
    if (!q || busy) return;
    const target = `/ask?q=${encodeURIComponent(q)}`;
    try {
      const user = await session(target);
      if (!user) return;
      if (!user.permissions.includes("chat:use")) {
        setPhase({ kind: "error", message: "This account can't ask questions. Log in as the Engineer demo below." });
        return;
      }
      setPhase({ kind: "busy", label: "Opening your workspace…" });
      router.push(target);
    } catch (e) {
      setPhase({ kind: "error", message: errorText(e) });
    }
  };

  const onDrop = (ev: DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    setDragging(false);
    void addFiles(Array.from(ev.dataTransfer.files));
  };

  return (
    <div className="relative">
      {/* Soft brand glow instead of a heavy shadow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-10 -top-12 bottom-0 -z-10 rounded-[48px] opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(40% 60% at 20% 40%, color-mix(in oklab, var(--accent) 22%, transparent), transparent)," +
            "radial-gradient(40% 60% at 80% 30%, color-mix(in oklab, var(--info) 16%, transparent), transparent)," +
            "radial-gradient(50% 50% at 60% 90%, color-mix(in oklab, var(--ok) 14%, transparent), transparent)",
        }}
      />
      <div className="rounded-2xl border border-border bg-panel p-4 sm:p-5">
        <p className="mb-4 text-lg font-semibold tracking-tight sm:text-xl">
          Add a PDF, Word file or scanned page, then ask anything about it.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={onDrop}
            className={cx(
              "group relative flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-6 text-center",
              "transition-colors duration-150",
              dragging
                ? "border-accent bg-accent-soft"
                : "border-accent/35 bg-accent/[0.03] hover:border-accent/70 hover:bg-accent-soft",
            )}
          >
            {busy ? (
              <div role="status" className="w-full max-w-xs">
                <p className="text-sm font-medium">{phase.label}</p>
                {phase.progress !== undefined && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-200"
                      style={{ width: `${Math.round(phase.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                <span className="grid h-11 w-11 place-items-center rounded-full bg-accent-soft text-accent">
                  <Icon name="upload" width={20} height={20} />
                </span>
                <p className="text-[15px] text-muted">{dragging ? "Drop to add it" : "Drag a file here, or"}</p>
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  className={cx(
                    "inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-panel px-4 text-sm font-medium",
                    "transition-colors duration-150 group-hover:border-transparent group-hover:bg-accent group-hover:text-accent-contrast",
                  )}
                >
                  <Icon name="paperclip" /> Choose a file
                </button>
                <p className="text-xs text-muted">PDF, Word (.docx), text, Markdown or scanned PDF · up to 25 MB</p>
              </>
            )}
            <input
              ref={input}
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose files to add"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>
          <form onSubmit={ask} className="flex min-h-40 flex-col rounded-xl border border-border bg-bg p-3">
            <label htmlFor="hero-question" className="text-sm font-medium">
              Or ask about the sample documents
            </label>
            <textarea
              id="hero-question"
              name="q"
              maxLength={4000}
              rows={3}
              placeholder="e.g. Who approves a database failover?"
              className="mt-2 flex-1 resize-none bg-transparent text-[15px] outline-none placeholder:text-muted"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs text-muted">Enter to ask · Shift+Enter for a new line</span>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-contrast hover:opacity-90 disabled:opacity-60"
              >
                Ask <Icon name="arrowRight" width={15} height={15} />
              </button>
            </div>
          </form>
        </div>
        {phase.kind === "error" && (
          <p role="alert" className="mt-3 rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
            {phase.message}
          </p>
        )}
      </div>
    </div>
  );
}
