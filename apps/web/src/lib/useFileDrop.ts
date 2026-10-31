"use client";

import { useEffect, useEffectEvent, useState } from "react";

// Browsers repeat dragover every ~350ms while a drag is over the page, so this much silence
// means the drag ended without a dragleave/drop reaching us (Safari, Esc over an iframe, etc.).
// Clearing here keeps the overlay from getting stuck on screen.
const STALE_MS = 1500;

/** Only OS file drags count. Text and link drags (e.g. into the composer) pass through untouched. */
function hasFiles(e: DragEvent): boolean {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

/** Window-level drag listeners (capture, depth counter, Files-only guard, always preventDefault
 *  dragover/drop). */
export function useFileDrop(opts: { enabled: boolean; onFiles: (files: File[]) => void }): { dragging: boolean } {
  const [dragging, setDragging] = useState(false);
  const isEnabled = useEffectEvent(() => opts.enabled);
  const deliver = useEffectEvent((files: File[]) => {
    if (opts.enabled && files.length > 0) opts.onFiles(files);
  });

  useEffect(() => {
    let depth = 0;
    let shown = false;
    let staleTimer: number | undefined;
    // A drag that started on this page (e.g. an image, which Chrome also types as "Files") is
    // not a file arriving from the OS, so it never shows the overlay or gets uploaded.
    let internal = false;
    const isFileDrag = (e: DragEvent) => !internal && hasFiles(e);

    const hide = () => {
      depth = 0;
      window.clearTimeout(staleTimer);
      if (shown) {
        shown = false;
        setDragging(false);
      }
    };
    const show = () => {
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(hide, STALE_MS);
      if (!shown) {
        shown = true;
        setDragging(true);
      }
    };
    const setEffect = (e: DragEvent) => {
      if (e.dataTransfer) e.dataTransfer.dropEffect = isEnabled() ? "copy" : "none";
    };

    const onEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setEffect(e);
      depth += 1;
      show();
    };
    // preventDefault even when disabled: otherwise the browser (notably Edge) opens the file in the tab.
    const onOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setEffect(e);
      depth = Math.max(depth, 1); // resync if the stale timer fired mid-drag
      show();
    };
    const onLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) hide();
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) {
        internal = false;
        return;
      }
      e.preventDefault();
      hide();
      deliver(Array.from(e.dataTransfer?.files ?? []));
    };
    const onStart = () => {
      internal = true;
    };
    const onEnd = () => {
      internal = false;
      hide();
    };
    // No pointer events fire during any drag, so a move means it is over, even if dragend was
    // lost (the source node was removed mid-drag). Keeps later OS drags from being ignored.
    const onPointerMove = () => {
      if (internal) internal = false;
    };

    window.addEventListener("dragstart", onStart, true);
    window.addEventListener("dragend", onEnd, true);
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: true });
    window.addEventListener("dragenter", onEnter, true);
    window.addEventListener("dragover", onOver, true);
    window.addEventListener("dragleave", onLeave, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragstart", onStart, true);
      window.removeEventListener("dragend", onEnd, true);
      window.removeEventListener("pointermove", onPointerMove, { capture: true });
      window.removeEventListener("dragenter", onEnter, true);
      window.removeEventListener("dragover", onOver, true);
      window.removeEventListener("dragleave", onLeave, true);
      window.removeEventListener("drop", onDrop, true);
      window.clearTimeout(staleTimer);
    };
  }, []);

  return { dragging };
}
