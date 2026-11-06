"use client";

import { createContext, useContext } from "react";
import type { WorkspaceApi } from "./types";

export const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error("useWorkspace used outside WorkspaceShell");
  return v;
}

export const HeaderSlotContext = createContext<HTMLElement | null>(null);

/** The slim header's content area for a createPortal of the page's title and actions (§5.1–5.2).
 *  Null when the header isn't rendered (>=1024px with the sidebar open): render them in the page. */
export function useHeaderSlot(): HTMLElement | null {
  return useContext(HeaderSlotContext);
}
