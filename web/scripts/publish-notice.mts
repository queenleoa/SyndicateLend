/**
 * Agent: create a private rate notice for the facility and publish its commitment to HCS.
 *   npx tsx scripts/publish-notice.mts <rateBps> [periodDays]
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { createAndCommit } = await import("../src/lib/notices");
const rateBps = Number(process.argv[2] ?? "725");
const days = Number(process.argv[3] ?? "30");
const now = Math.floor(Date.now() / 1000);
const n = await createAndCommit({ facilityId: "MHTLB-A", periodStart: now - days * 86400, periodEnd: now, rateBps, dayCountBasis: 360 });
const { nonce: _n, rateBps: _r, ...pub } = n;
console.log("published commitment", JSON.stringify(pub, null, 2));

process.exit(0)
