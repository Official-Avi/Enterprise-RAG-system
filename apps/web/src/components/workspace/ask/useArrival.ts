"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { pendingStore } from "@/lib/pendingStore";
import type { DocumentItem } from "@/lib/types";
import type { ScopeValue, UploadsApi } from "../types";
import { clearDraft, readDraft } from "./helpers";

// ?doc= is the spec'd hand-off (§3.2 step 6, §5.5); ?docs= and ?q= are what older landing
// builds sent. All three are read once and then stripped from the URL.
const HANDOFF_PARAMS = ["doc", "docs", "q"];

interface Options {
  /** chat:use. Nothing is consumed for a role that can't ask. */
  enabled: boolean;
  /** Documents, collections and a saved chat have loaded, so a question can be routed. */
  settled: boolean;
  /** The view shows a composer (not a blocked state). */
  canSend: boolean;
  docs: DocumentItem[];
  uploads: UploadsApi;
  setDraft: (value: string | ((current: string) => string)) => void;
  send: (text: string) => void;
  setScope: (value: ScopeValue) => void;
  showReading: (docIds: string[]) => void;
}

/** Everything that arrives with the page: files and a question from the landing page
 *  (lib/pendingStore), ?doc= ids from the landing page or My documents, and a question saved
 *  before a sign-in round trip (§3.2, §5.5, §5.6). */
export function useArrival({
  enabled,
  settled,
  canSend,
  docs,
  uploads,
  setDraft,
  send,
  setScope,
  showReading,
}: Options) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [autoQuestion, setAutoQuestion] = useState<string | null>(null);
  const [scopeDocs, setScopeDocs] = useState<string[] | null>(null);
  const handledQuery = useRef<string | null>(null);

  // Landing hand-off (taken exactly once) and a draft saved when the session ended.
  const takePending = useEffectEvent(() => {
    const pending = pendingStore.take();
    if (pending.files.length) void uploads.add(pending.files);
    const saved = readDraft();
    if (saved) clearDraft();
    if (pending.question) {
      // The user already pressed Enter on the landing page, so it sends once routing is known.
      if (pending.autoSend) setAutoQuestion(pending.question);
      else setDraft(pending.question);
    } else if (saved) {
      setDraft(saved);
    }
  });
  useEffect(() => {
    if (enabled) takePending();
  }, [enabled]);

  const fire = useEffectEvent((question: string) => {
    // A chat that can't take a question (blocked state) keeps it in the composer for later.
    if (canSend) send(question);
    else setDraft(question);
  });
  useEffect(() => {
    if (!autoQuestion || !settled) return;
    setAutoQuestion(null);
    fire(autoQuestion);
  }, [autoQuestion, settled]);

  const query = searchParams.toString();
  const handleQuery = useEffectEvent(() => {
    if (!query || handledQuery.current === query) return;
    handledQuery.current = query;
    const ids = [...searchParams.getAll("doc"), ...searchParams.getAll("docs")]
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean);
    const question = searchParams.get("q")?.trim();
    if (ids.length) {
      uploads.track(ids);
      showReading(ids);
      setScopeDocs(ids);
    }
    // A question in a URL is only ever filled in, never sent: links must not ask on a GET.
    if (question) setDraft((d) => d || question);

    const rest = new URLSearchParams(query);
    let changed = false;
    for (const key of HANDOFF_PARAMS) {
      if (rest.has(key)) {
        rest.delete(key);
        changed = true;
      }
    }
    if (changed) {
      const left = rest.toString();
      router.replace(left ? `${pathname}?${left}` : pathname, { scroll: false });
    }
  });
  useEffect(() => {
    if (enabled) handleQuery();
  }, [enabled, query]);

  // §5.8: ?doc= arrivals search the collection the file is in ("Searching: My documents · 5").
  const applyScope = useEffectEvent((ids: string[]) => {
    const byId = new Map(docs.map((d) => [d.id, d]));
    const found = [...new Set(ids.map((id) => byId.get(id)?.collection_id).filter((c): c is string => !!c))];
    const fallback = uploads.myCollection?.id;
    const scope = found.length ? found : fallback ? [fallback] : [];
    if (scope.length) setScope(scope);
  });
  useEffect(() => {
    if (!scopeDocs || !settled) return;
    setScopeDocs(null);
    applyScope(scopeDocs);
  }, [scopeDocs, settled]);
}
