// Module-level hand-off between the landing page and /ask. The single root layout keeps it alive
// across client navigation. Read with usePending(); `take` consumes the value exactly once.

import { useSyncExternalStore } from "react";

export interface Pending {
  files: File[];
  question: string | null;
  /** Send the question immediately on arrival (the user already pressed Enter). */
  autoSend: boolean;
}

const EMPTY: Pending = { files: [], question: null, autoSend: false };
let state: Pending = EMPTY;
const listeners = new Set<() => void>();

export const pendingStore = {
  set(next: Partial<Pending>) {
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  },
  take(): Pending {
    const value = state;
    state = EMPTY;
    listeners.forEach((l) => l());
    return value;
  },
  peek(): Pending {
    return state;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function usePending(): Pending {
  return useSyncExternalStore(pendingStore.subscribe, pendingStore.peek, () => EMPTY);
}
