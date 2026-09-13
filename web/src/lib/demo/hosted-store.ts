import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../data-dir";

export class HostedDemoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const RELEASE_LEASE = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
export const RENEW_LEASE = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
const WRITE_LEASED = "if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[2],ARGV[2]); return 1 else return 0 end";
const FINISH_OPERATOR = "if redis.call('GET',KEYS[1]) ~= ARGV[1] then return 0 end; local raw = redis.call('GET',KEYS[3]); if not raw then return -1 end; local ok, marker = pcall(cjson.decode,raw); if not ok or type(marker) ~= 'table' or marker.kind ~= ARGV[3] or marker.id ~= ARGV[4] then return -1 end; redis.call('SET',KEYS[2],ARGV[2]); redis.call('SET',KEYS[3],'null'); return 1";
const LEASE_MS = 120_000; // HTTP handlers end after 60 seconds; interrupted writes retain a durable review marker.
type LocalDocument = { values: Record<string, string> };
let localWriteTail: Promise<unknown> = Promise.resolve();

const REST_URL = () => process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REST_TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
const redisConfigured = () => Boolean(REST_URL() && REST_TOKEN());
const localDocumentPath = () => path.join(dataDir(), "hosted-workflows.json");
const localLeasePath = (scope: string) => path.join(dataDir(), `hosted-lease-${scope.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);

function readLocalDocument(): LocalDocument {
  try { return JSON.parse(fs.readFileSync(localDocumentPath(), "utf8")) as LocalDocument; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { values: {} };
    throw new HostedDemoError(503, "Built-in workflow storage is unavailable. No transaction was authorised.");
  }
}

function writeAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

async function localWrite<T>(work: () => T | Promise<T>): Promise<T> {
  const task = localWriteTail.catch(() => undefined).then(work);
  localWriteTail = task;
  return task;
}

function localLease(lease: HostedLease): { token: string; expiresAt: number } | null {
  try { return JSON.parse(fs.readFileSync(lease.key, "utf8")) as { token: string; expiresAt: number }; }
  catch { return null; }
}

export function hostedStorageConfigured() {
  // Redis is used when present. Otherwise a zero-configuration, single-instance file database keeps
  // workflow receipts and signed bytes durable across requests and process restarts.
  return true;
}

const key = (suffix: string) => `${process.env.STORE_NAMESPACE ?? "syndicatelend"}:hosted:${suffix}`;

async function command(parts: (string | number)[]) {
  if (!redisConfigured()) throw new HostedDemoError(503, "Distributed workflow storage is unavailable.");
  try {
    const response = await fetch(REST_URL()!, {
      method: "POST", headers: { Authorization: `Bearer ${REST_TOKEN()}`, "content-type": "application/json" },
      body: JSON.stringify(parts), cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { result?: unknown; error?: string };
    if (!response.ok || result.error) throw new Error("Redis rejected command");
    return result.result;
  } catch {
    throw new HostedDemoError(503, "Durable demo storage is unavailable. No new operation was authorised; inspect any pending operation before retrying.");
  }
}

export interface HostedLease { key: string; token: string; assertOwned(): Promise<void>; renew(): Promise<void> }

/** The agent bank signs one thing at a time; the market tick and a browser workflow share this lock. */
export const BUSY = "The agent bank is finishing another transaction. Retrying in a moment.";
export const isBusy = (error: unknown) => error instanceof HostedDemoError && error.status === 423;

/** Like withHostedLease, but wait up to `waitMs` for a busy lock (the market tick releases within a minute). */
export async function withHostedLeaseWait<T>(scope: string, waitMs: number, work: (lease: HostedLease) => Promise<T>): Promise<T> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { return await withHostedLease(scope, work); }
    catch (error) {
      if (!isBusy(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function hostedRead<T>(suffix: string): Promise<T | null> {
  if (!redisConfigured()) {
    const value = readLocalDocument().values[suffix];
    if (value === undefined) return null;
    try { return JSON.parse(value) as T; } catch { throw new HostedDemoError(503, "Built-in workflow state could not be read."); }
  }
  const value = await command(["GET", key(suffix)]);
  if (value === null) return null;
  if (typeof value !== "string") throw new HostedDemoError(503, "Durable demo state is invalid.");
  try { return JSON.parse(value) as T; } catch { throw new HostedDemoError(503, "Durable demo state could not be read."); }
}

export async function hostedWrite(suffix: string, value: unknown, lease: HostedLease) {
  if (!redisConfigured()) {
    await localWrite(async () => {
      await lease.assertOwned();
      const document = readLocalDocument();
      document.values[suffix] = JSON.stringify(value);
      writeAtomic(localDocumentPath(), document);
    });
    return;
  }
  const written = await command(["EVAL", WRITE_LEASED, 2, lease.key, key(suffix), lease.token, JSON.stringify(value)]);
  if (written !== 1) throw new HostedDemoError(409, "The demo operation lost its lease. Wait for the active request to finish.");
}

/** Commit a completed workflow and release its durable operator reservation in one atomic write. */
export async function hostedWriteAndReleaseOperator(suffix: string, value: unknown, lease: HostedLease, expected: { kind: "registry" | "issuance"; id: string }) {
  if (!redisConfigured()) {
    await localWrite(async () => {
      await lease.assertOwned();
      const document = readLocalDocument();
      let marker: { kind?: string; id?: string } | null = null;
      try { marker = JSON.parse(document.values["operator-workflow"] ?? "null") as { kind?: string; id?: string } | null; } catch { /* rejected below */ }
      if (marker?.kind !== expected.kind || marker.id !== expected.id) throw new HostedDemoError(409, "The operator reservation changed before completion could be recorded. No reservation belonging to another workflow was released.");
      document.values[suffix] = JSON.stringify(value);
      document.values["operator-workflow"] = "null";
      writeAtomic(localDocumentPath(), document);
    });
    return;
  }
  const written = await command(["EVAL", FINISH_OPERATOR, 3, lease.key, key(suffix), key("operator-workflow"), lease.token, JSON.stringify(value), expected.kind, expected.id]);
  if (written !== 1) throw new HostedDemoError(409, "The operator reservation changed before completion could be recorded. No reservation belonging to another workflow was released.");
}

/** Cross-instance lock. Never release or renew another request's lease; no server timers. */
export async function withHostedLease<T>(scope: string, work: (lease: HostedLease) => Promise<T>): Promise<T> {
  if (!redisConfigured()) {
    const leasePath = localLeasePath(scope);
    const token = randomUUID();
    fs.mkdirSync(path.dirname(leasePath), { recursive: true });
    const claim = () => {
      try {
        const descriptor = fs.openSync(leasePath, "wx", 0o600);
        fs.writeFileSync(descriptor, JSON.stringify({ token, expiresAt: Date.now() + LEASE_MS }));
        fs.closeSync(descriptor);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new HostedDemoError(503, "Built-in workflow locking is unavailable. No transaction was authorised.");
        const active = localLease({ key: leasePath, token, assertOwned: async () => undefined, renew: async () => undefined });
        if (active && active.expiresAt > Date.now()) return false;
        try { fs.unlinkSync(leasePath); } catch { return false; }
        return claim();
      }
    };
    if (!claim()) throw new HostedDemoError(423, BUSY);
    const lease: HostedLease = {
      key: leasePath, token,
      async assertOwned() {
        const active = localLease(lease);
        if (active?.token !== token || active.expiresAt <= Date.now()) throw new HostedDemoError(409, "The shared demo lease has expired. No further step was authorised.");
      },
      async renew() {
        await lease.assertOwned();
        writeAtomic(leasePath, { token, expiresAt: Date.now() + LEASE_MS });
      },
    };
    try { return await work(lease); }
    finally {
      if (localLease(lease)?.token === token) try { fs.unlinkSync(leasePath); } catch { /* already released */ }
    }
  }
  const lockKey = key(`${scope}:lease`);
  const token = randomUUID();
  if (await command(["SET", lockKey, token, "NX", "PX", LEASE_MS]) !== "OK") throw new HostedDemoError(423, BUSY);
  const lease: HostedLease = {
    key: lockKey, token,
    async assertOwned() { if (await command(["GET", lockKey]) !== token) throw new HostedDemoError(409, "The shared demo lease has expired. No further step was authorised."); },
    async renew() { if (await command(["EVAL", RENEW_LEASE, 1, lockKey, token, LEASE_MS]) !== 1) throw new HostedDemoError(409, "The shared demo lease could not be renewed."); },
  };
  try { return await work(lease); }
  finally { await command(["EVAL", RELEASE_LEASE, 1, lockKey, token]).catch(() => undefined); }
}
