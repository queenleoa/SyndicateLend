import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./data-dir";

/**
 * Small JSON document store with two backends and a synchronous API:
 *   - files under the data directory (local development, scripts);
 *   - Upstash Redis when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set (hosted demo:
 *     Vercel's filesystem is ephemeral, so anything that must outlive a cold start goes to Redis).
 *
 * Reads are served from an in-memory cache. `hydrate()` (called once per request by the session
 * helpers) refreshes the cache from Redis; writes update the cache and file immediately and persist
 * to Redis asynchronously, after the response when running inside a Next request.
 */
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const NS = process.env.STORE_NAMESPACE ?? "syndicatelend";
export const redisBacked = Boolean(REDIS_URL && REDIS_TOKEN);

const cache = new Map<string, unknown>();
const hydratedAt = new Map<string, number>();
const names = new Set<string>();
let pending: Promise<unknown>[] = [];

async function redis(cmd: string[]): Promise<unknown> {
  const res = await fetch(`${REDIS_URL}`, { method: "POST", headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(cmd), cache: "no-store" });
  const j = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok || j.error) throw new Error(`redis ${cmd[0]} ${cmd[1] ?? ""}: ${j.error ?? res.status}`);
  return j.result;
}

function filePath(name: string) {
  return path.join(dataDir(), `${name}.json`);
}

function readFile<T>(name: string, empty: T): T {
  const file = filePath(name);
  if (!fs.existsSync(file)) return structuredClone(empty);
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** Refresh every registered store from Redis (no-op with the file backend). Cheap: one MGET. */
export async function hydrate(maxAgeMs = 1500): Promise<void> {
  if (!redisBacked || names.size === 0) return;
  const now = Date.now();
  const stale = [...names].filter((n) => now - (hydratedAt.get(n) ?? 0) > maxAgeMs);
  if (stale.length === 0) return;
  const values = (await redis(["MGET", ...stale.map((n) => `${NS}:${n}`)])) as (string | null)[];
  stale.forEach((n, i) => {
    if (values[i] != null) cache.set(n, JSON.parse(values[i] as string));
    hydratedAt.set(n, now);
  });
}

/** Wait for asynchronous persistence (scripts call this before exiting). */
export async function flush(): Promise<void> {
  const p = pending;
  pending = [];
  await Promise.allSettled(p);
}

function persist(name: string, value: unknown) {
  if (!redisBacked) return;
  const task = redis(["SET", `${NS}:${name}`, JSON.stringify(value)]).catch((e) => console.error("[store] persist failed", name, (e as Error).message));
  pending.push(task);
  // Inside a Next request, keep the function alive until the write lands; elsewhere the promise is awaited by flush().
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { after } = require("next/server") as { after?: (fn: () => Promise<unknown>) => void };
    after?.(() => task);
  } catch {
    /* not in a request scope */
  }
}

export function jsonStore<T>(name: string, empty: T) {
  names.add(name);
  return {
    read(): T {
      if (redisBacked) {
        if (!cache.has(name)) cache.set(name, readFile(name, empty));
        return cache.get(name) as T;
      }
      return readFile(name, empty);
    },
    write(mutate: (t: T) => void): T {
      const t = this.read();
      mutate(t);
      const file = filePath(name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(t, null, 2) + "\n");
      if (redisBacked) {
        cache.set(name, t);
        hydratedAt.set(name, Date.now());
        persist(name, t);
      }
      return t;
    },
  };
}
