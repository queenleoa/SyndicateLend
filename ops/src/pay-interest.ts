/**
 * FR-12: pay the interest computed by the CRE confidential workflow, in mock USD.
 *
 * Input is the workflow's *released* output captured by `npm run demo:cre` in cre/evidence/distribution.json:
 * (commitment, periodId, holders, amounts). It carries no rate, day-count basis or nonce.
 *
 *   1. verify the commitment against the notice-commitment message on the HCS notices topic
 *   2. check each holder can receive mock USD (Hedera account exists, token associated, KYC granted, not frozen)
 *   3. mint the period's interest to the paying agent (the borrower's interest payment, modelled on the test token)
 *   4. credit every ready holder in ONE atomic HTS TransferTransaction
 *   5. publish an `interest-payout` receipt on the notices topic and record evidence for the UI
 *
 * This is the disclosed fallback path from the PRD (batched HTS transfers signed by the paying agent) rather
 * than an on-chain InterestDistributor consuming a DON-signed report.
 *
 *   npm run pay-interest -- [--facility MH-RCF] [--file <distribution.json>] [--dry-run] [--force] [--catch-up]
 *
 * --catch-up pays only the holders that an earlier payout of the same period skipped (for example a desk whose
 * quorum had not yet signed its mock-USD association) and merges them into that payout's evidence.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccountId, Hbar, TokenId, TokenMintTransaction, TopicId, TopicMessageSubmitTransaction, TransferTransaction } from "@hashgraph/sdk";
import { hederaClient, operatorId } from "./lib/client.js";
import { HASHSCAN } from "./lib/env.js";
import { mirrorGet } from "./lib/mirror.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";

interface Released {
  ranAt?: number;
  facilityId: string;
  periodId: number;
  commitment: string;
  days: string;
  distribution: { holder: string; amountUnits: string }[];
  totalUnits: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evidenceDir = path.resolve(here, "../../cre/evidence");
const fileArg = process.argv.indexOf("--file");
const facilityArg = process.argv.indexOf("--facility");
const facility = facilityArg > 0 ? process.argv[facilityArg + 1].toUpperCase() : null;
// Per-asset evidence lives in distributions/<SYMBOL>.json; the first tranche keeps the legacy single files.
const file = fileArg > 0 ? path.resolve(process.argv[fileArg + 1]) : facility ? path.join(evidenceDir, "distributions", `${facility}.json`) : path.join(evidenceDir, "distribution.json");
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const catchUp = process.argv.includes("--catch-up");

if (!fs.existsSync(file)) throw new Error(`no released distribution at ${file}; run \`npm run demo:cre\` first`);
const released = JSON.parse(fs.readFileSync(file, "utf8")) as Released;
const dep = readDeployments();
if (!dep.mockUsd || !dep.topics?.notices) throw new Error("deploy mock USD and topics first");
const usd = TokenId.fromString(dep.mockUsd.tokenId);
const topic = dep.topics.notices;

type PriorPayout = { commitment: string; paid: { holder: string; accountId: string; amountUnits: string }[]; skipped: { holder: string; reason: string }[]; batches?: { transactionId: string; hashscan: string; holders: number; units: string }[]; transactionId: string; hashscan: string; hcs?: { sequence: number; transactionId: string } };
const priors = ((dep.interestPayouts as PriorPayout[] | undefined) ?? []).filter((p) => p.commitment.toLowerCase() === released.commitment.toLowerCase());
const prior = priors[priors.length - 1];
if (prior && !force && !catchUp) throw new Error(`period ${released.periodId} (commitment ${released.commitment}) was already paid; pass --catch-up to pay only the holders it skipped, or --force to pay everyone again`);
const alreadyPaid = new Set(catchUp ? priors.flatMap((p) => p.paid.map((x) => x.holder.toLowerCase())) : []);
if (catchUp && !prior) console.log("no earlier payout for this period; --catch-up pays every ready holder");

// 1. The distribution must correspond to a commitment the agent actually published.
type MirrorMsg = { sequence_number: number; message: string; chunk_info?: { initial_transaction_id: unknown; number: number; total: number } | null };
const msgs = await mirrorGet<{ messages: MirrorMsg[] }>(`/topics/${topic}/messages?limit=100&order=desc`);
// Messages over 1024 bytes arrive as chunks; reassemble by initial_transaction_id before parsing.
const complete: { seq: number; text: string }[] = [];
const groups = new Map<string, MirrorMsg[]>();
for (const m of msgs.messages) {
  if (!m.chunk_info || m.chunk_info.total <= 1) { complete.push({ seq: m.sequence_number, text: Buffer.from(m.message, "base64").toString("utf8") }); continue; }
  const key = JSON.stringify(m.chunk_info.initial_transaction_id);
  groups.set(key, [...(groups.get(key) ?? []), m]);
}
for (const parts of groups.values()) {
  if (parts.length !== parts[0].chunk_info!.total) continue;
  parts.sort((a, b) => a.chunk_info!.number - b.chunk_info!.number);
  complete.push({ seq: parts[parts.length - 1].sequence_number, text: parts.map((x) => Buffer.from(x.message, "base64").toString("utf8")).join("") });
}
const committed = complete
  .sort((a, b) => b.seq - a.seq)
  .map((m) => ({ seq: m.seq, ev: safeJson(m.text) }))
  .find((m) => m.ev?.type === "notice-commitment" && m.ev.facilityId === released.facilityId && m.ev.periodId === released.periodId);
if (!committed) throw new Error(`no notice-commitment for ${released.facilityId} period ${released.periodId} on topic ${topic}`);
if (String(committed.ev.commitment).toLowerCase() !== released.commitment.toLowerCase()) {
  throw new Error(`released commitment ${released.commitment} does not match HCS #${committed.seq} (${committed.ev.commitment})`);
}
console.log(`commitment ${released.commitment} matches HCS #${committed.seq} on ${topic}`);

// 2. Who can actually receive the payment leg.
const paid: { holder: string; accountId: string; amountUnits: string }[] = [];
const skipped: { holder: string; reason: string }[] = [];
for (const d of released.distribution) {
  const holder = d.holder.toLowerCase();
  if (alreadyPaid.has(holder)) continue; // paid by the earlier payout of this period
  if (BigInt(d.amountUnits) === 0n) { skipped.push({ holder, reason: "no par in the register snapshot" }); continue; }
  const acct = await fetch(`${process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com"}/api/v1/accounts/${holder}`);
  if (acct.status === 404) { skipped.push({ holder, reason: "no Hedera account yet" }); continue; }
  const accountId = ((await acct.json()) as { account: string }).account;
  const rel = await mirrorGet<{ tokens: { kyc_status: string; freeze_status: string }[] }>(`/accounts/${accountId}/tokens?token.id=${usd}`);
  const t = rel.tokens[0];
  if (!t) { skipped.push({ holder, reason: "mock USD not associated (desk quorum has not executed the association intent)" }); continue; }
  if (t.kyc_status !== "GRANTED") { skipped.push({ holder, reason: "mock USD KYC not granted" }); continue; }
  if (t.freeze_status === "FROZEN") { skipped.push({ holder, reason: "mock USD frozen" }); continue; }
  paid.push({ holder, accountId, amountUnits: d.amountUnits });
}
const total = paid.reduce((a, p) => a + BigInt(p.amountUnits), 0n);
console.log(`payable now: ${paid.length} holders, ${fmt(total)} mUSD; skipped: ${skipped.length}${alreadyPaid.size ? `; already paid earlier: ${alreadyPaid.size}` : ""}`);
for (const p of paid) console.log(`  + ${p.holder} (${p.accountId}) ${fmt(BigInt(p.amountUnits))} mUSD`);
for (const s of skipped) console.log(`  - ${s.holder}: ${s.reason}`);
if (paid.length === 0) { console.log(catchUp ? "nothing new to pay: every remaining holder is still skipped (see reasons above)" : "nothing payable"); process.exit(catchUp ? 0 : 1); }
if (dryRun) { console.log("dry run: no transaction sent"); process.exit(0); }

const client = hederaClient();
const memo = `SyndicateLend interest ${released.facilityId} P${released.periodId}`;

// 3. Borrower's interest payment arrives at the paying agent (mint on the test instrument).
const mint = await new TokenMintTransaction().setTokenId(usd).setAmount(total).setTransactionMemo(memo).execute(client);
const mintRc = await mint.getReceipt(client);
console.log(`minted ${fmt(total)} mUSD to the paying agent: ${mintRc.status} ${mint.transactionId}`);

// 4. Atomic HTS transfers: within a transaction every holder is credited or none is. Hedera caps the number
//    of token-transfer entries per transaction, so large holder lists are paid in batches of BATCH credits.
const BATCH = 9;
const toHashscan = (id: string) => `${HASHSCAN}/transaction/${id.replace(/^(0\.0\.\d+)@(\d+)\.(\d+)$/, "$1-$2-$3")}`; // HashScan uses the 0.0.x-sec-nanos form
const batches: { transactionId: string; hashscan: string; holders: number; units: string }[] = [];
for (let i = 0; i < paid.length; i += BATCH) {
  const slice = paid.slice(i, i + BATCH);
  const sum = slice.reduce((a, p) => a + BigInt(p.amountUnits), 0n);
  const xfer = new TransferTransaction().setTransactionMemo(memo).setMaxTransactionFee(new Hbar(5)).addTokenTransfer(usd, operatorId(), -Number(sum));
  for (const p of slice) xfer.addTokenTransfer(usd, AccountId.fromString(p.accountId), Number(BigInt(p.amountUnits)));
  const tx = await xfer.execute(client);
  const rc = await tx.getReceipt(client);
  const id = tx.transactionId.toString();
  batches.push({ transactionId: id, hashscan: toHashscan(id), holders: slice.length, units: sum.toString() });
  console.log(`batch ${batches.length}: ${rc.status} ${slice.length} holders ${fmt(sum)} mUSD ${toHashscan(id)}`);
}
const transactionId = batches[0].transactionId;
const hashscanTx = batches[0].hashscan;
console.log(`interest paid to ${paid.length} holders in ${batches.length} transaction(s)`);

// 5. Receipt on the notices topic (public: who was paid how much, against which commitment) and evidence files.
const receipt = { v: 1, at: Date.now(), type: "interest-payout", facilityId: released.facilityId, periodId: released.periodId, commitment: released.commitment, transactionId, batches: batches.map((b) => b.transactionId), totalPaidUnits: total.toString(), paid: paid.length, skipped };
const pub = await new TopicMessageSubmitTransaction().setTopicId(TopicId.fromString(topic)).setMessage(JSON.stringify(receipt)).execute(client);
const pubRc = await pub.getReceipt(client);
const hcs = { sequence: pubRc.topicSequenceNumber?.toNumber() ?? 0, transactionId: pub.transactionId.toString() };
console.log(`payout receipt published: HCS #${hcs.sequence} ${HASHSCAN}/topic/${topic}`);

// A catch-up merges into the earlier payout's evidence so the register sees one complete payout per period.
const merged = catchUp && prior ? {
  paid: [...priors.flatMap((p) => p.paid), ...paid],
  batches: [...priors.flatMap((p) => p.batches ?? [{ transactionId: p.transactionId, hashscan: p.hashscan, holders: p.paid.length, units: p.paid.reduce((a, x) => a + BigInt(x.amountUnits), 0n).toString() }]), ...batches],
  transactionId: prior.transactionId, hashscan: prior.hashscan,
} : { paid, batches, transactionId, hashscan: hashscanTx };
const evidence = { ranAt: Date.now(), facilityId: released.facilityId, periodId: released.periodId, commitment: released.commitment, mintTransactionId: mint.transactionId.toString(), transactionId: merged.transactionId, hashscan: merged.hashscan, batches: merged.batches, totalPaidUnits: merged.paid.reduce((a, p) => a + BigInt(p.amountUnits), 0n).toString(), paid: merged.paid, skipped, hcs, ...(catchUp && prior ? { catchUpOf: prior.transactionId } : {}) };
fs.mkdirSync(path.join(evidenceDir, "payouts"), { recursive: true });
fs.writeFileSync(path.join(evidenceDir, "payouts", `${released.facilityId}.json`), JSON.stringify(evidence, null, 2) + "\n");
if (!facility || facility === (dep.loanToken as { symbol?: string } | undefined)?.symbol) fs.writeFileSync(path.join(evidenceDir, "payout.json"), JSON.stringify(evidence, null, 2) + "\n");
writeDeployments((d) => {
  const list = ((d.interestPayouts as unknown[]) ??= []) as typeof evidence[];
  list.push(evidence);
});
console.log(`evidence written to cre/evidence/payouts/${released.facilityId}.json and ops/deployments/${dep.network}.json`);
process.exit(0);

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
function fmt(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${frac}`;
}
