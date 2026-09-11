/**
 * Export settled trades from the SettlementEngine as assignment records an agent's loan system or a
 * ClearPar-style workflow can ingest, so the on-chain settlement is processed in the agent's book without
 * re-keying. Fields follow the LSTA assignment-agreement vocabulary (assignor, assignee, assigned principal,
 * purchase price, trade date, settlement date). Output: ops/exports/assignments-<facility>.csv and one JSON per trade.
 *
 *   npm run export-assignments
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider } from "ethers";
import { HASHSCAN, RPC_URL } from "./lib/env.js";
import { mirrorGet } from "./lib/mirror.js";
import { readDeployments } from "./lib/deployments.js";

const require = createRequire(import.meta.url);
const engineAbi = require("../../contracts/out/SettlementEngine.sol/SettlementEngine.json").abi;
const here = path.dirname(fileURLToPath(import.meta.url));
const STATE = ["None", "AwaitingApprovals", "Scheduled", "Settled", "Failed", "Cancelled"];

const dep = readDeployments();
const provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
const engine = new Contract(dep.settlementEngine!.address, engineAbi, provider);
const facility = dep.loanToken!.symbol as string;
const nameOf = (addr: string) => (dep.institutions ?? []).find((i) => i.evmAddress.toLowerCase() === addr.toLowerCase())?.name ?? addr;
const iso = (secs: number | string) => new Date(Number(secs) * 1000).toISOString();

// Engine event logs from the mirror node, indexed by event and trade id. The engine clears `scheduleAddress`
// once a trade settles or fails, so the schedule id and the settlement instant come from the logs.
const SIG = {
  scheduled: "0x91edd169deabeee5d3fb329049e10fb0f106355d1b87663bb0fa9cb42858db8c", // TradeScheduled(uint256,address,uint64)
  settled: "0x21a4e93bc292518c83e5623a9dde5c8df7f96b1561c0afca68fbe100b11221cf", // TradeSettled(uint256,address,address,uint256,uint256)
};
type Log = { timestamp: string; transaction_hash: string; topics: string[]; data: string };
const logs: Log[] = [];
let page: string | null = `/contracts/${dep.settlementEngine!.address}/results/logs?limit=100&order=asc`;
while (page) {
  const r: { logs: Log[]; links: { next: string | null } } = await mirrorGet(page);
  logs.push(...r.logs);
  page = r.links?.next ? r.links.next.replace(/^\/api\/v1/, "") : null;
}
const logFor = (sig: string, id: number) => logs.find((l) => l.topics[0] === sig && BigInt(l.topics[1]) === BigInt(id));

const next = Number(await engine.nextTradeId());
const records: Record<string, string>[] = [];
for (let id = 1; id < next; id++) {
  const t = await engine.getTrade(id);
  const state = STATE[Number(t.state)];
  const par = BigInt(t.par);
  const cash = BigInt(t.cash);
  const pricePct = (Number((cash * 1_000_000n) / par) / 1e10).toFixed(4); // cash 6dp per 1 par unit (US$1)
  const scheduled = logFor(SIG.scheduled, id);
  const settled = logFor(SIG.settled, id);
  const scheduleId = scheduled ? `0.0.${parseInt(scheduled.data.slice(0, 66), 16)}` : "";
  const settlementTs = settled ? iso(settled.timestamp.split(".")[0]) : "";
  const rec = {
    trade_id: String(id),
    facility_id: facility,
    tranche: String(dep.loanToken!.name ?? ""),
    register_token: dep.loanToken!.tokenId as string,
    assignor: nameOf(t.seller),
    assignor_wallet: t.seller,
    assignee: nameOf(t.buyer),
    assignee_wallet: t.buyer,
    assigned_principal_usd: par.toString(),
    purchase_price_pct: pricePct,
    purchase_amount_usd: (Number(cash) / 1e6).toFixed(2),
    settlement_currency: "mUSD (test)",
    earliest_settlement: iso(t.settleAt),
    expiry: iso(t.expiresAt),
    state,
    settlement_timestamp: settlementTs,
    schedule_id: scheduleId,
    schedule_link: scheduleId ? `${HASHSCAN}/schedule/${scheduleId}` : "",
    settlement_transaction: settled ? `${HASHSCAN}/transaction/${settled.transaction_hash}` : "",
    rfq_reference: t.rfqRef,
    failure_reason: state === "Failed" ? t.failureReason : "",
    agent: dep.operator!.accountId,
  };
  records.push(rec);
}
const outDir = path.resolve(here, "../exports");
fs.mkdirSync(outDir, { recursive: true });
const cols = Object.keys(records[0] ?? {});
const csv = [cols.join(","), ...records.map((r) => cols.map((c) => `"${String(r[c]).replace(/"/g, '""')}"`).join(","))].join("\n") + "\n";
fs.writeFileSync(path.join(outDir, `assignments-${facility}.csv`), csv);
for (const r of records) fs.writeFileSync(path.join(outDir, `assignment-${facility}-${r.trade_id}.json`), JSON.stringify(r, null, 2) + "\n");
console.table(records.map((r) => ({ trade: r.trade_id, assignor: r.assignor, assignee: r.assignee, par: r.assigned_principal_usd, price: r.purchase_price_pct, state: r.state, settled: r.settlement_timestamp || "-" })));
console.log(`${records.length} trades exported to ${path.relative(process.cwd(), outDir)} (${records.filter((r) => r.state === "Settled").length} settled)`);
process.exit(0);
