/**
 * Seed the hosted (Redis-backed) store from this machine's web/data files, once, so a Vercel deployment has the
 * same institutions (Meridian, Halcyon, Aldgate, Bishopsgate, judge desks), trades, rate notices and market log
 * as local development. web/data is gitignored, so nothing else ships these records.
 *
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... npx tsx scripts/seed-hosted-store.mts [--force]
 *
 * Refuses to overwrite a store that already has institutions unless --force is given. After seeding, run the
 * local dev server with MARKET_TICK=off (or without the Redis variables) so two ticks never drive the same
 * desk wallets. Never run this while the hosted app is mid-workflow.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
if (!url || !token) throw new Error("Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL/TOKEN) to the hosted store first.");
const ns = process.env.STORE_NAMESPACE ?? "syndicatelend";
const force = process.argv.includes("--force");
const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? "data");
async function redis(cmd: (string | number)[]) {
  const r = await fetch(url!, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(cmd) });
  const j = await r.json() as { result?: unknown; error?: string };
  if (!r.ok || j.error) throw new Error(`Redis ${cmd[0]} failed: ${j.error ?? r.status}`);
  return j.result;
}
const existing = await redis(["GET", `${ns}:org`]) as string | null;
const count = existing ? (JSON.parse(existing) as { institutions?: unknown[] }).institutions?.length ?? 0 : 0;
if (count > 0 && !force) throw new Error(`The hosted store already holds ${count} institutions. Re-run with --force to overwrite it with the local files.`);
for (const name of ["org", "trades", "notices", "market"]) {
  const file = path.join(dataDir, `${name}.json`);
  if (!fs.existsSync(file)) { console.log(`${name}: no local file, skipped`); continue; }
  const value = fs.readFileSync(file, "utf8");
  await redis(["SET", `${ns}:${name}`, JSON.stringify(JSON.parse(value))]);
  console.log(`${name}: seeded (${value.length} bytes)`);
}
const hostedFile = path.join(dataDir, "hosted-workflows.json");
if (fs.existsSync(hostedFile)) {
  const doc = JSON.parse(fs.readFileSync(hostedFile, "utf8")) as { values: Record<string, string> };
  for (const [suffix, value] of Object.entries(doc.values)) {
    if (suffix === "operator-workflow") continue; // never carry a local operator reservation to production
    await redis(["SET", `${ns}:hosted:${suffix}`, value]);
    console.log(`hosted:${suffix}: seeded`);
  }
}
const org = JSON.parse(fs.readFileSync(path.join(dataDir, "org.json"), "utf8")) as { institutions: { id: string; automated?: boolean; selfService?: boolean }[] };
console.log(`done: ${org.institutions.length} institutions (${org.institutions.filter((i) => i.automated).map((i) => i.id).join(", ")} automated). Start local dev with MARKET_TICK=off from now on.`);
