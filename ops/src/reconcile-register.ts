/**
 * Shadow-register reconciliation: the agent's own register export against the ATS token register.
 *
 * This is the integration hook the pilot runs on. The agent exports its lender register from its loan system
 * (Loan IQ, an in-house book, a Versana feed) as CSV; nothing is re-keyed. Each lender is resolved to its
 * on-chain wallet (explicit `lender_wallet` column, else by institution name from the deployment record),
 * the ATS balance is read, and every row is marked AGREES or BREAK. The agreement rate is the pilot's
 * headline metric (PRD 9.2). Positions never leave the operator: only a hash of the report is attested on HCS.
 *
 *   npm run reconcile -- [--file ops/samples/agent-register-MHTLB-A.csv] [--attest]
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider } from "ethers";
import { TopicId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { hederaClient } from "./lib/client.js";
import { HASHSCAN, RPC_URL } from "./lib/env.js";
import { diamond } from "./lib/diamond.js";
import { readDeployments } from "./lib/deployments.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fileArg = process.argv.indexOf("--file");
const file = fileArg > 0 ? path.resolve(process.argv[fileArg + 1]) : path.resolve(here, "../samples/agent-register-MHTLB-A.csv");
const attest = process.argv.includes("--attest");

interface Row { facility_id: string; tranche: string; lender_name: string; lender_lei: string; lender_wallet: string; commitment_usd: string; as_of: string }
function parseCsv(text: string): Row[] {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.trim());
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v.trim()])) as unknown as Row);
}

const dep = readDeployments();
const token = dep.loanToken!.evmAddress as string;
const facility = dep.loanToken!.symbol as string;
const rows = parseCsv(fs.readFileSync(file, "utf8")).filter((r) => r.facility_id === facility);
if (rows.length === 0) throw new Error(`no rows for facility ${facility} in ${file}`);

const provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
const loan = diamond(token, provider);
const byName = new Map((dep.institutions ?? []).map((i) => [i.name.toLowerCase(), i.evmAddress.toLowerCase()]));

type Line = { lender: string; lei: string; wallet: string | null; book: string; register: string; difference: string; status: "AGREES" | "BREAK" | "UNMAPPED" };
const lines: Line[] = [];
for (const r of rows) {
  const wallet = (r.lender_wallet || byName.get(r.lender_name.toLowerCase()) || null)?.toLowerCase() ?? null;
  const book = BigInt(r.commitment_usd);
  if (!wallet) { lines.push({ lender: r.lender_name, lei: r.lender_lei, wallet: null, book: book.toString(), register: "-", difference: "-", status: "UNMAPPED" }); continue; }
  const register: bigint = await loan.getFunction("balanceOf")(wallet);
  const diff = register - book;
  lines.push({ lender: r.lender_name, lei: r.lender_lei, wallet, book: book.toString(), register: register.toString(), difference: diff.toString(), status: diff === 0n ? "AGREES" : "BREAK" });
}
// Wallets on the register that the agent's book does not list at all.
const listed = new Set(lines.map((l) => l.wallet).filter(Boolean));
for (const i of dep.institutions ?? []) {
  const w = i.evmAddress.toLowerCase();
  if (listed.has(w) || !i.loanEligible) continue;
  const register: bigint = await loan.getFunction("balanceOf")(w);
  if (register > 0n) lines.push({ lender: `${i.name} (not in agent book)`, lei: "", wallet: w, book: "0", register: register.toString(), difference: register.toString(), status: "BREAK" });
}
const totalSupply: bigint = await loan.getFunction("totalSupply")();
const bookTotal = lines.reduce((a, l) => a + BigInt(l.book), 0n);
const agree = lines.filter((l) => l.status === "AGREES").length;
const report = {
  facilityId: facility,
  token,
  asOf: rows[0].as_of,
  source: path.basename(file),
  generatedAt: new Date().toISOString(),
  lines,
  totals: { agentBook: bookTotal.toString(), registerSupply: totalSupply.toString(), difference: (totalSupply - bookTotal).toString() },
  agreementRate: `${agree}/${lines.length}`,
  breaks: lines.filter((l) => l.status !== "AGREES").map((l) => ({ lender: l.lender, difference: l.difference, status: l.status })),
};

console.log(`Reconciliation ${facility} as of ${report.asOf} (agent book: ${report.source})`);
console.table(lines.map((l) => ({ lender: l.lender, wallet: l.wallet ? `${l.wallet.slice(0, 8)}…` : "-", "agent book": l.book, "ATS register": l.register, difference: l.difference, status: l.status })));
console.log(`agent book total ${bookTotal} vs register supply ${totalSupply}; agreement ${report.agreementRate}`);
// Hint the operator at the likeliest cause: equal and opposite breaks are an unprocessed assignment.
const b = report.breaks.filter((x) => x.status === "BREAK");
if (b.length === 2 && BigInt(b[0].difference) + BigInt(b[1].difference) === 0n) {
  console.log(`likely cause: an assignment of ${BigInt(b[0].difference) > 0n ? b[0].difference : b[1].difference} par from ${BigInt(b[0].difference) < 0n ? b[0].lender : b[1].lender} to ${BigInt(b[0].difference) > 0n ? b[0].lender : b[1].lender} settled on the register but is not yet processed in the agent's book (see npm run export-assignments)`);
}

fs.mkdirSync(path.resolve(here, "../reports"), { recursive: true });
const out = path.resolve(here, `../reports/reconciliation-${facility}-${report.asOf}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
const reportHash = "0x" + createHash("sha256").update(fs.readFileSync(out)).digest("hex");
console.log(`report ${path.relative(process.cwd(), out)} sha256 ${reportHash}`);

if (attest) {
  const msg = { v: 1, at: Date.now(), type: "reconciliation", facilityId: facility, asOf: report.asOf, lines: lines.length, agreementRate: report.agreementRate, breaks: b.length, reportHash };
  const client = hederaClient();
  const tx = await new TopicMessageSubmitTransaction().setTopicId(TopicId.fromString(dep.topics!.notices!)).setMessage(JSON.stringify(msg)).execute(client);
  const rc = await tx.getReceipt(client);
  console.log(`attested on HCS #${rc.topicSequenceNumber} ${HASHSCAN}/topic/${dep.topics!.notices} (hash only; positions stay with the agent)`);
}
process.exit(0);
