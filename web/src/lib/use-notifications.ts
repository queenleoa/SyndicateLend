"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useApi } from "./use-me";
import type { ApprovalNotifications } from "./approval-notifications";

export const APPROVALS_UPDATED = "syndicate:approvals-updated";

export function useNotifications() {
  const api = useApi();
  const { ready, authenticated, user } = usePrivy();
  const [snapshot, setSnapshot] = useState<{ userId: string; value: ApprovalNotifications } | null>(null);
  const [failure, setFailure] = useState<{ userId: string; message: string } | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const userId = user?.id ?? "";
  const refresh = useCallback(async () => {
    if (!ready || !authenticated || !userId || inFlight.current) return;
    const started = generation.current;
    inFlight.current = true;
    try {
      const value = await api("/api/notifications") as ApprovalNotifications;
      if (started === generation.current) { setSnapshot({ userId, value }); setFailure(null); }
    } catch (error) {
      if (started === generation.current) setFailure({ userId, message: (error as Error).message });
    } finally { inFlight.current = false; }
  }, [api, ready, authenticated, userId]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, 10_000); };
    void poll();
    const onUpdated = () => { void refresh(); };
    window.addEventListener(APPROVALS_UPDATED, onUpdated);
    const cleanupGeneration = generation.current + 1;
    return () => { stopped = true; generation.current = cleanupGeneration; clearTimeout(timer); window.removeEventListener(APPROVALS_UPDATED, onUpdated); };
  }, [refresh]);

  return {
    notifications: authenticated && snapshot?.userId === userId ? snapshot.value : null,
    error: authenticated && failure?.userId === userId ? failure.message : null,
    refresh,
  };
}
