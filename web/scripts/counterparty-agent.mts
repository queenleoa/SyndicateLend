/**
 * Demo counterparty: watches the live HCS RFQ topic and submits one quote for
 * every open RFQ created by another institution.
 *
 * This automates only market-making. It does not impersonate a Privy member or
 * approve wallet actions; both institutions must still satisfy their real quorum.
 *
 *   npm run demo:counterparty -- --institution halcyon --price 99.00
 *   npm run demo:counterparty -- --institution halcyon --price 99.00 --once
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { hydrate, flush } = await import("../src/lib/store");

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith("--")) args.set(arg.slice(2), process.argv[i + 1]?.startsWith("--") ? "true" : process.argv[++i] ?? "true");
}

const institutionId = args.get("institution") ?? "halcyon";
const basePrice = Number(args.get("price") ?? "99.00");
const settleMinutes = Number(args.get("settle-minutes") ?? "5");
const validMinutes = Number(args.get("valid-minutes") ?? "30");
const once = args.has("once");
if (!(basePrice > 0 && basePrice < 200)) throw new Error("--price must be a price per 100, for example 99.00");

const [{ loadRfqs, newId }, { publish }, { readOrg }] = await Promise.all([
  import("../src/lib/rfq"), import("../src/lib/hcs"), import("../src/lib/org"),
]);
await hydrate();
const institution = readOrg().institutions.find((i) => i.id === institutionId);
if (!institution?.wallet) throw new Error(`institution '${institutionId}' is not provisioned with a Privy desk wallet`);

const handled = new Set<string>();
console.log(`[counterparty] ${institution.name} connected; watching the Hedera HCS market tape`);
console.log(`[counterparty] strategy: quote ${basePrice.toFixed(2)}, settle +${settleMinutes}m, valid ${validMinutes}m`);

async function quoteOpenRfqs() {
  const { rfqs } = await loadRfqs();
  const candidates = rfqs.filter((r) => r.status === "open" && r.institution !== institutionId && !r.quotes.some((q) => q.institution === institutionId) && !handled.has(r.rfqId));
  for (const rfq of candidates) {
    handled.add(rfq.rfqId);
    console.log(`[counterparty] received ${rfq.rfqId}: ${rfq.side} ${Number(rfq.par).toLocaleString("en-US")} par`);
    const now = Math.floor(Date.now() / 1000);
    const quoteId = newId("q");
    const receipt = await publish({
      type: "quote",
      rfqId: rfq.rfqId,
      quoteId,
      price: basePrice.toFixed(2),
      settleAt: now + settleMinutes * 60,
      expiresAt: now + validMinutes * 60,
      institution: institutionId,
      by: `demo-agent:${institutionId}`,
    });
    console.log(`[counterparty] quoted ${quoteId} @ ${basePrice.toFixed(2)} · HCS sequence ${receipt.sequence} · ${receipt.status}`);
  }
  if (once) {
    await flush();
    process.exit(0);
  }
}

await quoteOpenRfqs();
const timer = setInterval(() => quoteOpenRfqs().catch((e) => console.error(`[counterparty] ${e.message}`)), 4_000);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { clearInterval(timer); console.log("\n[counterparty] disconnected"); void flush().finally(() => process.exit(0)); });
