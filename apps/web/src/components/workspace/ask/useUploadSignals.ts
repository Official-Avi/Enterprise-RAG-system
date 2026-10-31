"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TERMINAL_PHASES, type UploadPhase } from "@/lib/status";
import type { TrackedUpload } from "../types";
import { isHoldPhase } from "./helpers";

/** The one centred system row of the chat (§5.5). The announcer and the "(Ready) " title prefix
 *  come from UploadsProvider, which sees every phase change; this only decides what to show. */
export type SystemNote =
  | { kind: "reading"; docIds: string[] }
  | { kind: "ready"; names: string[]; pageCount: number | null };

export function useUploadSignals(items: TrackedUpload[]) {
  const [note, setNote] = useState<SystemNote | null>(null);
  // Phases seen on the previous change; null until the first run, so rows that were already
  // there when the chat opened never count as "just became ready".
  const phases = useRef<Map<string, UploadPhase> | null>(null);

  useEffect(() => {
    const before = phases.current;
    phases.current = new Map(items.map((u) => [u.key, u.phase]));
    if (!before) return;

    const ready = items.filter((u) => {
      const was = before.get(u.key);
      return u.phase === "indexed" && was !== undefined && !TERMINAL_PHASES.has(was);
    });
    if (ready.length) {
      setNote({
        kind: "ready",
        names: ready.map((u) => u.filename),
        pageCount: ready.length === 1 ? (ready[0].pageCount ?? null) : null,
      });
      return;
    }
    // A "Reading…" row goes once none of its files is still being read (failures show on the chip).
    setNote((n) => {
      if (n?.kind !== "reading") return n;
      const reading = items.some((u) => u.documentId && n.docIds.includes(u.documentId) && isHoldPhase(u.phase));
      return reading ? n : null;
    });
  }, [items]);

  const showReading = useCallback((docIds: string[]) => setNote({ kind: "reading", docIds }), []);
  const clear = useCallback(() => setNote(null), []);

  return { note, showReading, clear };
}
