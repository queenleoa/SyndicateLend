/**
 * Agent: create a private rate notice for the facility and publish its commitment to HCS.
 *   npx tsx scripts/publish-notice.mts <rateBps> [periodDays]
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { hydrate, flush } = await import("../src/lib/store");
await hydrate();
const { createAndCommit } = await import("../src/lib/notices");
const rateBps = Number(process.argv[2] ?? "725");
const days = Number(process.argv[3] ?? "30");
const now = Math.floor(Date.now() / 1000);
const n = await createAndCommit({ facilityId: "MHTLB-A", periodStart: now - days * 86400, periodEnd: now, rateBps, dayCountBasis: 360 });
const pub = { facilityId: n.facilityId, periodId: n.periodId, periodStart: n.periodStart, periodEnd: n.periodEnd, holders: n.holders, commitment: n.commitment, createdAt: n.createdAt, hcs: n.hcs };
console.log("published commitment", JSON.stringify(pub, null, 2));

await flush();
process.exit(0)
