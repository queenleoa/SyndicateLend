/**
 * Retail feeder holders on public testnet: the account driver for the register.
 *
 * A feeder (here Northgate Insurance, acting as the pass-through vehicle) distributes small par positions to
 * many holders. Each holder is a real Hedera account on the public network and a KYC-gated position on the
 * ATS register, created the same way as the institutional lenders: alias funding, mock-USD association and
 * KYC, ATS whitelist and internal KYC, then a compliance-checked transfer of par from the feeder. From then on
 * the accrual workflow and the payout treat them like any other holder; only the holder list is longer.
 *
 * Holder keys are local (ops/.feeder-keys.json, gitignored); only addresses and account ids are recorded.
 * Idempotent: holders already recorded are skipped, so the script can be re-run to add more.
 *
 *   npm run feeder -- [--holders 25] [--par 1000] [--hbar 1]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccountId, Hbar, PrivateKey, TokenAssociateTransaction, TokenGrantKycTransaction, TokenId, TransferTransaction } from "@hashgraph/sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import { hederaClient, operatorId } from "./lib/client.js";
import { HASHSCAN, RPC_URL, requireEnv } from "./lib/env.js";
import { connectAts, sdk } from "./lib/ats.js";
import { diamond, send } from "./lib/diamond.js";
import { accountIdForEvm, waitFor } from "./lib/mirror.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";

function arg(name: string, def: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}
const target = Number(arg("holders", "25"));
const par = BigInt(arg("par", "1000"));
const hbar = Number(arg("hbar", "1"));

const here = path.dirname(fileURLToPath(import.meta.url));
const keysFile = path.resolve(here, "../.feeder-keys.json");
type Key = { address: string; privateKey: string };
const keys: Key[] = fs.existsSync(keysFile) ? JSON.parse(fs.readFileSync(keysFile, "utf8")) : [];
while (keys.length < target) {
  const w = Wallet.createRandom();
  keys.push({ address: w.address, privateKey: w.privateKey });
}
fs.writeFileSync(keysFile, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });

const dep = readDeployments();
const token = dep.loanToken!.evmAddress as string;
const usd = TokenId.fromString(dep.mockUsd!.tokenId);
const feederName = "Northgate Insurance";
const feederKey = requireEnv("DESK_LENDER3_PRIVATE_KEY");
type Holder = { evmAddress: string; accountId: string; par: string; fundTx: string; transferTx: string };
const done: Holder[] = ((dep.feeder as { holders?: Holder[] } | undefined)?.holders ?? []);
const doneSet = new Set(done.map((h) => h.evmAddress.toLowerCase()));

const client = hederaClient();
const provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
const { wallet } = await connectAts();
const { Security, ControlListRequest } = sdk;
const d = diamond(token);
const loanAsFeeder = diamond(token, new Wallet(feederKey, provider));
const now = Math.floor(Date.now() / 1000);

let txCount = 0;
const t0 = Date.now();
for (const k of keys.slice(0, target)) {
  const evm = k.address.toLowerCase();
  if (doneSet.has(evm)) continue;
  console.log(`\nholder ${done.length + 1}/${target} ${evm}`);
  // Every step below is resumable: a holder that was half onboarded by an interrupted run (account funded,
  // token associated, listed on the register) is completed rather than repeated.
  // 1. Alias funding creates the public-network account.
  let accountId = await accountIdForEvm(evm);
  let fundTx = "existing";
  if (accountId) console.log(`  account ${accountId} already exists`);
  else {
    const fund = await new TransferTransaction().addHbarTransfer(operatorId(), new Hbar(-hbar)).addHbarTransfer(AccountId.fromEvmAddress(0, 0, evm), new Hbar(hbar)).execute(client);
    await fund.getReceipt(client);
    txCount++;
    fundTx = fund.transactionId.toString();
    accountId = await waitFor(() => accountIdForEvm(evm), `account for ${evm}`);
    console.log(`  account ${accountId} created (${fund.transactionId})`);
  }
  // 2. Mock-USD association (holder signs) and KYC (agent signs).
  const holderKey = PrivateKey.fromStringECDSA(k.privateKey);
  try {
    const assoc = await (await new TokenAssociateTransaction().setAccountId(AccountId.fromString(accountId)).setTokenIds([usd]).freezeWith(client).sign(holderKey)).execute(client);
    await assoc.getReceipt(client);
    txCount++;
  } catch (e) {
    if (!/TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT/.test(String(e))) throw e;
  }
  const kyc = await new TokenGrantKycTransaction().setAccountId(AccountId.fromString(accountId)).setTokenId(usd).execute(client);
  await kyc.getReceipt(client);
  txCount++;
  console.log(`  mock USD associated and KYC granted`);
  // 3. ATS eligibility: whitelist and internal KYC on the security.
  if (!(await d.getFunction("isInControlList")(evm))) {
    await Security.addToControlList(new ControlListRequest({ securityId: token, targetId: evm }));
    txCount++;
  }
  if (Number(await d.getFunction("getKycStatusFor")(evm)) !== 1) {
    await send(d, "grantKyc", [evm, `kyc:feeder:${evm.slice(2, 10)}`, now, now + 365 * 24 * 3600, wallet.address]);
    txCount++;
  }
  console.log(`  ATS whitelist and KYC granted`);
  // 4. Compliance-checked transfer of par from the feeder to the holder.
  let transferTx = "existing";
  if ((await d.getFunction("balanceOf")(evm)) < par) {
    const tx = await loanAsFeeder.getFunction("transfer")(evm, par, { gasLimit: 1_500_000 });
    const rcpt = await tx.wait();
    if (rcpt?.status !== 1) throw new Error(`par transfer to ${evm} failed: ${tx.hash}`);
    txCount++;
    transferTx = tx.hash;
    console.log(`  ${par} par transferred from ${feederName}: ${HASHSCAN}/transaction/${tx.hash}`);
  } else console.log(`  holder already holds its par`);
  const holder: Holder = { evmAddress: evm, accountId, par: par.toString(), fundTx, transferTx };
  done.push(holder);
  writeDeployments((x) => {
    const f = ((x.feeder as Record<string, unknown> | undefined) ?? { name: feederName, source: (dep.institutions ?? []).find((i) => i.role === "lender")?.evmAddress, parPerHolder: par.toString() }) as Record<string, unknown>;
    f.holders = done;
    f.updatedAt = new Date().toISOString();
    x.feeder = f;
  });
}
console.log(`\n${done.length} feeder holders on the register; ${txCount} transactions this run in ${Math.round((Date.now() - t0) / 1000)}s (6 per new holder)`);
process.exit(0);
