import { MIRROR_URL } from "./env.js";

export async function mirrorGet<T = any>(pathname: string): Promise<T> {
  const res = await fetch(`${MIRROR_URL}/api/v1${pathname}`);
  if (!res.ok) throw new Error(`mirror ${pathname}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Resolve a 0.0.x account id from an EVM address (or return null if the account does not exist yet). */
export async function accountIdForEvm(evmAddress: string): Promise<string | null> {
  const res = await fetch(`${MIRROR_URL}/api/v1/accounts/${evmAddress}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`mirror accounts: ${res.status}`);
  const j = (await res.json()) as { account: string };
  return j.account;
}

/** Poll the mirror node until a predicate holds (mirror lags consensus by a few seconds). */
export async function waitFor<T>(fn: () => Promise<T | null>, label: string, attempts = 20): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    const v = await fn();
    if (v !== null) return v;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`timed out waiting for ${label}`);
}
