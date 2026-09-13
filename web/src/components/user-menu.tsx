"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/use-me";

export function UserMenu({ canReset = false }: { canReset?: boolean }) {
  const { ready, authenticated, user, logout } = usePrivy();
  const api = useApi();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ready) return <div className="text-sm text-ink-muted">…</div>;
  if (!authenticated) return null;
  const email = user?.email?.address ?? user?.google?.email ?? user?.id;
  const reset = async () => {
    if (busy || !window.confirm("Reset your desk? Your institution record is dropped and a fresh one is provisioned on the next page load. On-chain history is kept.")) return;
    setBusy(true); setError(null);
    try {
      await api("/api/me/reset", { method: "POST" });
      router.replace("/institution");
      window.setTimeout(() => window.location.reload(), 300);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-ink">{email}</span>
      {canReset && <button className="btn btn-ghost btn-sm" onClick={() => void reset()} disabled={busy} title="Test helper: drop this institution and provision a fresh one">{busy ? "Resetting…" : "Reset desk"}</button>}
      {error && <span className="text-bad">{error}</span>}
      <button className="btn btn-secondary" onClick={() => logout()}>
        Sign out
      </button>
    </div>
  );
}
