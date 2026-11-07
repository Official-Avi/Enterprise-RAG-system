"use client";

import { createContext, useContext } from "react";
import type { UploadsApi } from "./types";

export const UploadsContext = createContext<UploadsApi | null>(null);

export function useUploads(): UploadsApi {
  const v = useContext(UploadsContext);
  if (!v) throw new Error("useUploads used outside UploadsProvider");
  return v;
}
