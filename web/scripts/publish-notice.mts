/**
 * Agent: create a private rate notice for an asset and publish its commitment to HCS.
 *   npx tsx scripts/publish-notice.mts [--facility MHTLB-A] [--rate 725] [--days 30]
 * Legacy positional form still works: npx tsx scripts/publish-notice.mts 725 30
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { hydrate, flush } = await import("../src/lib/store");
await hydrate();
const { createAndCommit } = await import("../src/lib/notices");
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const positional = process.argv.slice(2).filter((v) => !v.startsWith("--") && !process.argv[process.argv.indexOf(v) - 1]?.startsWith("--"));
const facilityId = arg("facility", "MHTLB-A");
const rateBps = Number(arg("rate", positional[0] ?? "725"));
const days = Number(arg("days", positional[1] ?? "30"));
const now = Math.floor(Date.now() / 1000);
const n = await createAndCommit({ facilityId, periodStart: now - days * 86400, periodEnd: now, rateBps, dayCountBasis: 360 });
const pub = { facilityId: n.facilityId, periodId: n.periodId, periodStart: n.periodStart, periodEnd: n.periodEnd, holders: n.holders.length, commitment: n.commitment, createdAt: n.createdAt, hcs: n.hcs };
console.log("published commitment", JSON.stringify(pub, null, 2));

await flush();
process.exit(0);
