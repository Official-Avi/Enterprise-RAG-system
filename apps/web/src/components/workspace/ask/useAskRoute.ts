"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { routeFromPath, type AskRoute } from "./helpers";

const NEW_CHAT_PATH = "/ask";

function isPlainClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** One key per chat view. A new key remounts the view (fresh turns, scope, sources), except when
 *  the URL change is the view's own `history.replaceState` to /ask/c/{id} after its first answer
 *  (§2.1: the page never unmounts mid-request). */
export function useAskRoute(): { key: number; route: AskRoute; adopt: (sessionId: string) => void } {
  const pathname = usePathname();
  // The session the current view created and moved the URL to.
  const adopted = useRef<string | null>(null);
  const [view, setView] = useState({ key: 0, path: pathname });

  let key = view.key;
  if (view.path !== pathname) {
    const next = routeFromPath(pathname);
    if (!(next.kind === "saved" && next.id === adopted.current)) key += 1;
    setView({ key, path: pathname });
  }

  // A remounted view has adopted nothing yet.
  useEffect(() => {
    adopted.current = null;
  }, [key]);

  // "New chat" (sidebar, header icon, Ctrl+Shift+O) while already on /ask changes nothing the
  // router reports, yet a question asked here (still on /ask after an error, or held) must go.
  useEffect(() => {
    const fresh = () => setView((v) => ({ ...v, key: v.key + 1 }));
    // next/link has already called preventDefault by the time a document listener runs, so
    // defaultPrevented says nothing here; the link's own href decides.
    const onClick = (e: MouseEvent) => {
      if (!isPlainClick(e) || window.location.pathname !== NEW_CHAT_PATH) return;
      const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === NEW_CHAT_PATH && !url.search) fresh();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || !(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return;
      if ((e.key.toLowerCase() === "o" || e.code === "KeyO") && window.location.pathname === NEW_CHAT_PATH) fresh();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const adopt = useCallback((sessionId: string) => {
    adopted.current = sessionId;
  }, []);

  return { key, route: routeFromPath(pathname), adopt };
}
