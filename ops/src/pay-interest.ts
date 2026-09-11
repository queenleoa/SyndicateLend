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
 *   npm run pay-interest -- [--file <distribution.json>] [--dry-run] [--force]
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
const file = fileArg > 0 ? path.resolve(process.argv[fileArg + 1]) : path.join(evidenceDir, "distribution.json");
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

if (!fs.existsSync(file)) throw new Error(`no released distribution at ${file}; run \`npm run demo:cre\` first`);
const released = JSON.parse(fs.readFileSync(file, "utf8")) as Released;
const dep = readDeployments();
if (!dep.mockUsd || !dep.topics?.notices) throw new Error("deploy mock USD and topics first");
const usd = TokenId.fromString(dep.mockUsd.tokenId);
const topic = dep.topics.notices;

const prior = ((dep.interestPayouts as { commitment: string }[] | undefined) ?? []).find((p) => p.commitment.toLowerCase() === released.commitment.toLowerCase());
if (prior && !force) throw new Error(`period ${released.periodId} (commitment ${released.commitment}) was already paid; pass --force to pay again`);

// 1. The distribution must correspond to a commitment the agent actually published.
const msgs = await mirrorGet<{ messages: { sequence_number: number; message: string }[] }>(`/topics/${topic}/messages?limit=100&order=desc`);
const committed = msgs.messages
  .map((m) => ({ seq: m.sequence_number, ev: safeJson(Buffer.from(m.message, "base64").toString("utf8")) }))
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
console.log(`payable now: ${paid.length} holders, ${fmt(total)} mUSD; skipped: ${skipped.length}`);
for (const p of paid) console.log(`  + ${p.holder} (${p.accountId}) ${fmt(BigInt(p.amountUnits))} mUSD`);
for (const s of skipped) console.log(`  - ${s.holder}: ${s.reason}`);
if (paid.length === 0) throw new Error("nothing payable");
if (dryRun) { console.log("dry run: no transaction sent"); process.exit(0); }

const client = hederaClient();
const memo = `SyndicateLend interest ${released.facilityId} P${released.periodId}`;

// 3. Borrower's interest payment arrives at the paying agent (mint on the test instrument).
const mint = await new TokenMintTransaction().setTokenId(usd).setAmount(total).setTransactionMemo(memo).execute(client);
const mintRc = await mint.getReceipt(client);
console.log(`minted ${fmt(total)} mUSD to the paying agent: ${mintRc.status} ${mint.transactionId}`);

// 4. One atomic HTS transfer: every holder is credited or none is.
const xfer = new TransferTransaction().setTransactionMemo(memo).setMaxTransactionFee(new Hbar(5)).addTokenTransfer(usd, operatorId(), -Number(total));
for (const p of paid) xfer.addTokenTransfer(usd, AccountId.fromString(p.accountId), Number(BigInt(p.amountUnits)));
const tx = await xfer.execute(client);
const rc = await tx.getReceipt(client);
const transactionId = tx.transactionId.toString();
const hashscanTx = `${HASHSCAN}/transaction/${transactionId.replace(/^(0\.0\.\d+)@(\d+)\.(\d+)$/, "$1-$2-$3")}`; // HashScan uses the 0.0.x-sec-nanos form
console.log(`interest paid: ${rc.status} ${hashscanTx}`);

// 5. Receipt on the notices topic (public: who was paid how much, against which commitment) and evidence files.
const receipt = { v: 1, at: Date.now(), type: "interest-payout", facilityId: released.facilityId, periodId: released.periodId, commitment: released.commitment, transactionId, totalPaidUnits: total.toString(), paid, skipped };
const pub = await new TopicMessageSubmitTransaction().setTopicId(TopicId.fromString(topic)).setMessage(JSON.stringify(receipt)).execute(client);
const pubRc = await pub.getReceipt(client);
const hcs = { sequence: pubRc.topicSequenceNumber?.toNumber() ?? 0, transactionId: pub.transactionId.toString() };
console.log(`payout receipt published: HCS #${hcs.sequence} ${HASHSCAN}/topic/${topic}`);

const evidence = { ranAt: Date.now(), facilityId: released.facilityId, periodId: released.periodId, commitment: released.commitment, mintTransactionId: mint.transactionId.toString(), transactionId, hashscan: hashscanTx, totalPaidUnits: total.toString(), paid, skipped, hcs };
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, "payout.json"), JSON.stringify(evidence, null, 2) + "\n");
writeDeployments((d) => {
  const list = ((d.interestPayouts as unknown[]) ??= []) as typeof evidence[];
  list.push(evidence);
});
console.log(`evidence written to cre/evidence/payout.json and ops/deployments/${dep.network}.json`);
process.exit(0);

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
function fmt(units: bigint): string {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString("en-US")}.${frac}`;
}
