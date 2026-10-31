"use client";

import { useCallback, useRef, useState } from "react";
import type { AnswerView, Citation, Turn } from "../types";

/** §5.7: the docked panel opens by itself on the first cited answer, only on wide screens. */
const AUTO_OPEN_QUERY = "(min-width: 1440px)";
const NO_CITATIONS: Citation[] = [];

function latestCited(turns: Turn[]): Turn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.status === "answered" && t.answer && t.answer.citations.length > 0) return t;
  }
  return undefined;
}

/** Which answer's sources the panel/sheet shows (default: the latest cited one), the active
 *  marker, open state, and the focus hand-back to whatever opened it (§5.7, §9 #7). */
export function useSourcesState(turns: Turn[]) {
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [activeMarker, setActiveMarker] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const autoOpened = useRef(false);

  const picked = selectedTurnId ? turns.find((t) => t.id === selectedTurnId && t.answer) : undefined;
  const selected = picked ?? latestCited(turns);
  const citations = selected?.answer?.citations ?? NO_CITATIONS;

  const remember = () => {
    const el = document.activeElement;
    opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
  };

  const onCite = (turnId: string, citation: Citation) => {
    remember();
    setSelectedTurnId(turnId);
    setActiveMarker(citation.marker);
    setOpen(true);
  };

  const onOpenSources = (turnId: string) => {
    remember();
    setSelectedTurnId(turnId);
    setActiveMarker(null);
    setOpen(true);
  };

  /** Paging or clicking a card. Pins the shown answer so the marker belongs to it. */
  const onSelect = (marker: number) => {
    if (!picked && selected) setSelectedTurnId(selected.id);
    setActiveMarker(marker);
  };

  /** Close, then give focus back to the chip or button that opened the panel ("Back to answer").
   *  Waits a frame so a closing <dialog> has released focus first. */
  const close = () => {
    setOpen(false);
    const el = opener.current;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (el?.isConnected && (!active || active === document.body)) el.focus({ preventScroll: true });
    });
  };

  const toggle = () => {
    if (open) {
      close();
      return;
    }
    remember();
    setOpen(true);
  };

  /** A fresh answer arrived. Cited answers become the panel's default; the first one in a chat
   *  opens the panel at >= 1440px, without moving focus. */
  const noteAnswer = useCallback((answer: AnswerView, hadCitationsBefore: boolean) => {
    if (answer.citations.length === 0) return;
    setSelectedTurnId(null);
    setActiveMarker(null);
    if (hadCitationsBefore || autoOpened.current) return;
    autoOpened.current = true;
    if (window.matchMedia(AUTO_OPEN_QUERY).matches) setOpen(true);
  }, []);

  return {
    /** null = the latest cited answer. */
    selectedTurnId: picked ? picked.id : null,
    activeMarker: picked ? activeMarker : null,
    citations,
    open,
    onCite,
    onOpenSources,
    onSelect,
    close,
    toggle,
    noteAnswer,
  };
}
