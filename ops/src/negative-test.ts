/**
 * Prove the restrictions on-chain (FR-02 / FR-03):
 *   1. an eligible seller cannot transfer loan tokens to an unverified account (ATS control list + KYC)
 *   2. a KYC'd buyer cannot transfer mock USD to an account without KYC (HTS KYC key)
 * Both attempts are real transactions whose failure is visible on HashScan.
 *   npx tsx src/negative-test.ts
 */
import { AccountId, PrivateKey, TokenAssociateTransaction, TokenId, TransferTransaction } from "@hashgraph/sdk";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { hederaClient, operatorId } from "./lib/client.js";
import { HASHSCAN, RPC_URL, requireEnv } from "./lib/env.js";
import { diamond } from "./lib/diamond.js";
import { readDeployments } from "./lib/deployments.js";

const dep = readDeployments();
const outsider = requireEnv("DESK_OUTSIDER_EVM_ADDRESS");
const provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });

// 1. Loan token: seller -> outsider must revert.
const seller = new Wallet(requireEnv("DESK_SELLER_PRIVATE_KEY"), provider);
const loan = diamond(dep.loanToken!.evmAddress as string, seller);
try {
  const tx = await loan.getFunction("transfer")(outsider, 1000, { gasLimit: 1_000_000 });
  const rcpt = await tx.wait();
  console.log(`loan transfer to outsider: status=${rcpt?.status} tx=${tx.hash} (EXPECTED FAILURE)`);
} catch (e: any) {
  const hash = e?.receipt?.hash ?? e?.transactionHash ?? e?.transaction?.hash;
  console.log(`loan transfer to outsider REJECTED on-chain${hash ? `: ${HASHSCAN}/transaction/${hash}` : ""}`);
  console.log(`  reason: ${(e?.shortMessage ?? e?.message ?? "").slice(0, 160)}`);
}
console.log(`  outsider loan balance: ${await loan.getFunction("balanceOf")(outsider)}`);

// 2. Mock USD: associate the outsider (its own signature) but grant no KYC, then buyer -> outsider must fail.
const client = hederaClient();
const usd = TokenId.fromString(dep.mockUsd!.tokenId);
const outsiderId = AccountId.fromString(dep.institutions!.find((i) => i.role === "outsider")!.accountId!);
const buyerInst = dep.institutions!.find((i) => i.role === "buyer")!;
const outsiderKey = PrivateKey.fromStringECDSA(requireEnv("DESK_OUTSIDER_PRIVATE_KEY"));
const buyerKey = PrivateKey.fromStringECDSA(requireEnv("DESK_BUYER_PRIVATE_KEY"));

const assoc = await fetch(`https://testnet.mirrornode.hedera.com/api/v1/accounts/${outsiderId}/tokens?token.id=${usd}`).then((r) => r.json());
if (!assoc.tokens?.length) {
  const a = await (await new TokenAssociateTransaction().setAccountId(outsiderId).setTokenIds([usd]).freezeWith(client).sign(outsiderKey)).execute(client);
  console.log(`outsider associated with mUSD (no KYC): ${(await a.getReceipt(client)).status}`);
}
try {
  const t = await (
    await new TransferTransaction()
      .addTokenTransfer(usd, AccountId.fromString(buyerInst.accountId!), -1_000_000)
      .addTokenTransfer(usd, outsiderId, 1_000_000)
      .freezeWith(client)
      .sign(buyerKey)
  ).execute(client);
  const rc = await t.getReceipt(client);
  console.log(`mUSD transfer to outsider: ${rc.status} (EXPECTED FAILURE) tx ${t.transactionId}`);
} catch (e: any) {
  console.log(`mUSD transfer to outsider REJECTED: ${e?.status?.toString?.() ?? e?.message}`);
  if (e?.transactionId) console.log(`  ${HASHSCAN}/transaction/${e.transactionId.toString()}`);
}
client.close();
