"use client";

import { createContext, useContext } from "react";
import type { WorkspaceApi } from "./types";

export const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function useWorkspace(): WorkspaceApi {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error("useWorkspace used outside WorkspaceShell");
  return v;
}
