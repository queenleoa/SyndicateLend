"use client";

import { usePrivy } from "@privy-io/react-auth";

export function UserMenu() {
  const { ready, authenticated, user, logout } = usePrivy();
  if (!ready) return <div className="text-xs text-ink-muted">…</div>;
  if (!authenticated) return null;
  const email = user?.email?.address ?? user?.google?.email ?? user?.id;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-ink">{email}</span>
      <button className="btn btn-secondary" onClick={() => logout()}>
        Sign out
      </button>
    </div>
  );
}
