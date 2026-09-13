/**
 * Rebuild a named institution's org.json record from its Privy wallet history and Hedera receipts after the
 * record was dropped (for example by a desk reset). Nothing is created or signed: Privy intents are listed,
 * executed transactions are decoded for their hashes, and the mirror node supplies the operator-side receipts.
 *
 *   npx tsx scripts/recover-institution.mts meridian
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
import fs from "node:fs";
import path from "node:path";
import { Transaction } from "ethers";
const { hydrate, flush } = await import("../src/lib/store");
await hydrate();
const { readOrg, writeOrg } = await import("../src/lib/org");
const { listWalletIntents } = await import("../src/lib/approvals");
const { signedTxOf } = await import("../src/lib/desk-tx");
const { venue } = await import("../src/lib/venue");

type Known = { id: string; name: string; members: { email: string; role: "trader" | "compliance" | "pm"; privyUserId: string }[]; keyQuorumId: string; wallet: { id: string; address: string }; policyId: string; accountId: string; fundTx: string; eligibilityTx: string; allocatedPar: string; usdFunded: string };
const KNOWN: Record<string, Known> = {
  meridian: {
    id: "meridian", name: "Meridian Credit Partners",
    members: [
      { email: "adrija11235@gmail.com", role: "trader", privyUserId: "did:privy:cmtvrqj77032x0cl781w3i3kl" },
      { email: "adrija11235+compliance@gmail.com", role: "compliance", privyUserId: "did:privy:cmtvrqkum00tl0bjot2f31ix0" },
      { email: "adrija11235+pm@gmail.com", role: "pm", privyUserId: "did:privy:cmtvrqmbp00lg0cl8jkztrp56" },
    ],
    keyQuorumId: "kmyw0au8xynt4kkraplmux4n", wallet: { id: "ztgwiswdq08r1lxmg1qlw4vy", address: "0xA6bE8BBdC1175538349E745fF7AB4A0f9D5Cb2fB" }, policyId: "ll87e9sl07o5mj3iddadk22f",
    accountId: "0.0.10477813", fundTx: "0x0f318aa1c606de121cc63b1bfb0645561594ed292bf8951d8929e2fa8ce2bac1", eligibilityTx: "0xf6aa2fd18fffcc99e84a8b559ab6cfa6232630721a79cfc4bb67c8f1c0528c3b",
    allocatedPar: "10000000", usdFunded: "15000000",
  },
};
const id = process.argv[2];
const known = KNOWN[id];
if (!known) throw new Error(`no recovery data for ${id}`);
if (readOrg().institutions.some((i) => i.id === id)) throw new Error(`${id} already exists in org.json`);

const MIRROR = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
const v = venue();
const get = async <T,>(path: string): Promise<T> => { const r = await fetch(`${MIRROR}/api/v1${path}`); if (!r.ok) throw new Error(`mirror ${path}: ${r.status}`); return (await r.json()) as T; };
const pad = (address: string) => `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Operator-side receipts from the mirror node.
// Topic filters on the mirror node need a timestamp window (7 days max); the desk was allocated this week.
const now = Math.floor(Date.now() / 1000);
const since = now - 6 * 86_400;
const mint = await get<{ logs: { transaction_hash: string; topics: string[] }[] }>(`/contracts/${v.loanToken}/results/logs?topic0=${TRANSFER}&topic2=${pad(known.wallet.address)}&timestamp=gte:${since}.000000000&timestamp=lte:${now}.000000000&order=asc&limit=10`);
const allocateTx = mint.logs.find((l) => l.topics[1] === pad("0x0"))?.transaction_hash;
// KYC grants carry no transfers, so the account filter does not list them; the relationship proves the grant.
const relationship = await get<{ tokens: { kyc_status?: string }[] }>(`/accounts/${known.accountId}/tokens?token.id=${JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../ops/deployments/testnet.json"), "utf8")).mockUsd.tokenId}`);
const usdKycTx = relationship.tokens[0]?.kyc_status === "GRANTED" ? "recovered:kyc-granted-on-chain" : undefined;
const transfers = await get<{ transactions: { transaction_id: string; name: string; token_transfers?: { token_id: string; account: string; amount: number }[] }[] }>(`/transactions?account.id=${known.accountId}&limit=100&order=asc`);
const usdFundTx = transfers.transactions.find((t) => t.token_transfers?.some((x) => x.account === known.accountId && x.amount === Number(known.usdFunded) * 1_000_000))?.transaction_id ?? (usdKycTx ? "recovered:funded-on-chain" : undefined);

// Desk-signed steps from the wallet's executed Privy intents.
const intents = (await listWalletIntents(known.wallet.id)) as { intent_id: string; status: string; authorization_details?: { threshold: number; members: { signed_at: number | null }[] }[]; action_result?: { response_body?: { data?: { signed_transaction?: string } } } }[];
const steps: Record<string, { intentId: string; status: string; signatures: number; threshold: number; txHash: string }> = {};
for (const it of intents.filter((i) => i.status === "executed")) {
  const signed = signedTxOf(it as never);
  if (!signed) continue;
  const tx = Transaction.from(signed);
  const to = (tx.to ?? "").toLowerCase();
  const selector = tx.data.slice(0, 10);
  const step = to === v.mockUsd.toLowerCase() && selector === "0x0a754de6" ? "usdAssociate" : to === v.loanToken.toLowerCase() && selector === "0x095ea7b3" ? "allowLoan" : to === v.mockUsd.toLowerCase() && selector === "0x095ea7b3" ? "allowUsd" : null;
  if (!step) continue;
  // The list is newest first; keep the newest executed intent per step whose transaction actually succeeded.
  if (steps[step]) continue;
  const outcome = await get<{ result?: string }>(`/contracts/results/${tx.hash}`).catch(() => null);
  if (outcome?.result !== "SUCCESS") continue;
  const q = it.authorization_details?.[0];
  steps[step] = { intentId: it.intent_id, status: "executed", signatures: q?.members.filter((m) => m.signed_at).length ?? 2, threshold: q?.threshold ?? 2, txHash: tx.hash! };
}
for (const step of ["usdAssociate", "allowLoan", "allowUsd"]) if (!steps[step]) console.warn(`warning: no executed ${step} intent found on the wallet`);
if (!allocateTx || !usdKycTx || !usdFundTx) console.warn(`warning: missing operator receipt(s): allocate=${allocateTx} kyc=${usdKycTx} fund=${usdFundTx}`);

const record = {
  id: known.id, name: known.name, members: known.members, keyQuorumId: known.keyQuorumId, wallet: known.wallet, policyId: known.policyId, loanEligible: true,
  hedera: { fundTx: known.fundTx, accountId: known.accountId, eligibilityTx: known.eligibilityTx, allocateTx, allocatedPar: known.allocatedPar, ...steps, usdKycTx, usdFundTx, usdFunded: known.usdFunded },
  recovered: new Date().toISOString(),
};
writeOrg((o) => { o.institutions.unshift(record as never); });
await flush();
console.log(JSON.stringify(record, null, 2));
process.exit(0);
