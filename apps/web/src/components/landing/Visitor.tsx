"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { personaFor } from "@/lib/demo";
import type { DemoInfo, DemoPersona, Me } from "@/lib/types";
import { currentUser, demoLogin, fetchDemoInfo } from "@/lib/workspace";

interface Visitor {
  ready: boolean;
  me: Me | null;
  demo: DemoInfo | null;
  /** The demo persona the visitor is signed in as, or null. */
  persona: DemoPersona | null;
  /** The demo list could not be loaded because the server is down or failing (network or 5xx). */
  unreachable: boolean;
  /** Load the visitor and the demo list again; `ready` is false until it finishes. */
  reload: () => void;
  /** One-click demo sign-in; resolves to the new user. */
  signInAs: (persona: string) => Promise<Me>;
}

/** Network failures and 5xx mean "the server isn't there", as opposed to a refusal. */
export function isUnreachable(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || e.status >= 500);
}

const VisitorContext = createContext<Visitor | null>(null);

/** Who is looking at the public page (signed in or not) and which demo personas exist. */
export function VisitorProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [demo, setDemo] = useState<DemoInfo | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [ready, setReady] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([currentUser(), fetchDemoInfo()]).then(([user, info]) => {
      if (cancelled) return;
      setMe(user.status === "fulfilled" ? user.value : null);
      setDemo(info.status === "fulfilled" ? info.value : null);
      setUnreachable(info.status === "rejected" && isUnreachable(info.reason));
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setReady(false);
    setAttempt((n) => n + 1);
  }, []);

  const signInAs = useCallback(async (persona: string) => {
    const user = await demoLogin(persona);
    setMe(user);
    return user;
  }, []);

  const value = useMemo<Visitor>(
    () => ({ ready, me, demo, persona: personaFor(me, demo), unreachable, reload, signInAs }),
    [ready, me, demo, unreachable, reload, signInAs],
  );

  return <VisitorContext.Provider value={value}>{children}</VisitorContext.Provider>;
}

export function useVisitor(): Visitor {
  const v = useContext(VisitorContext);
  if (!v) throw new Error("useVisitor used outside VisitorProvider");
  return v;
}
