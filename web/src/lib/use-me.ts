"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";

export interface Me {
  userId: string;
  role: "trader" | "compliance" | "pm" | null;
  roleLabel?: string;
  institution: {
    id: string;
    name: string;
    wallet: { id: string; address: string } | null;
    keyQuorumId: string | null;
    policyId: string | null;
    members: { email: string; role: string }[];
  } | null;
}

/** Authenticated fetch helper: attaches the Privy access token. */
export function useApi() {
  const { getAccessToken } = usePrivy();
  return useCallback(
    async (input: string, init: RequestInit = {}) => {
      const token = await getAccessToken();
      const headers = new Headers(init.headers);
      if (token) headers.set("authorization", `Bearer ${token}`);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      const res = await fetch(input, { ...init, headers });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `${res.status}`);
      return json;
    },
    [getAccessToken],
  );
}

export function useMe() {
  const { ready, authenticated } = usePrivy();
  const api = useApi();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    if (!ready || !authenticated) return;
    api("/api/me").then(setMe).catch((e) => setError(e.message));
  }, [ready, authenticated, api]);
  useEffect(reload, [reload]);
  return { me, error, reload };
}
