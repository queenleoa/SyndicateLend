/**
 * Reverse a duplicate mock-USD desk funding with the paying agent's wipe key (the agent bank holds the
 * supply/wipe keys of the synthetic cash token). Run from web/:
 *   npx tsx scripts/wipe-duplicate-funding.mts <institution-id> <whole-mUSD-amount>
 * Example, after Meridian was funded twice on 2026-09-13:
 *   npx tsx scripts/wipe-duplicate-funding.mts meridian 15000000
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
import fs from "node:fs";
import { AccountId, Client, PrivateKey, TokenId, TokenWipeTransaction } from "@hashgraph/sdk";
const { hydrate, flush } = await import("../src/lib/store");
await hydrate();
const { readOrg, writeOrg } = await import("../src/lib/org");

const [id, whole] = process.argv.slice(2);
if (!id || !/^[1-9]\d*$/.test(whole ?? "")) throw new Error("usage: wipe-duplicate-funding.mts <institution-id> <whole-mUSD-amount>");
const inst = readOrg().institutions.find((i) => i.id === id) as { hedera?: { accountId?: string; usdFunded?: string } } | undefined;
if (!inst?.hedera?.accountId) throw new Error(`${id} has no Hedera account on record`);
const client = Client.forTestnet();
const key = PrivateKey.fromStringECDSA(process.env.OPERATOR_PRIVATE_KEY!);
client.setOperator(AccountId.fromString(process.env.OPERATOR_ACCOUNT_ID!), key);
const token = TokenId.fromString(JSON.parse(fs.readFileSync("../ops/deployments/testnet.json", "utf8")).mockUsd.tokenId);
const units = BigInt(whole) * 1_000_000n;
const tx = await (await new TokenWipeTransaction().setTokenId(token).setAccountId(AccountId.fromString(inst.hedera.accountId)).setAmount(units).setTransactionMemo("SyndicateLend: reverse duplicate desk funding").freezeWith(client).sign(key)).execute(client);
const receipt = await tx.getReceipt(client);
console.log(`wiped ${whole} mUSD from ${id} (${inst.hedera.accountId}): ${receipt.status.toString()} ${tx.transactionId.toString()}`);
writeOrg((o) => {
  const target = o.institutions.find((i) => i.id === id) as typeof inst;
  if (target?.hedera) target.hedera.usdFunded = (BigInt(target.hedera.usdFunded ?? "0") - BigInt(whole)).toString();
});
await flush();
client.close();
process.exit(0);
