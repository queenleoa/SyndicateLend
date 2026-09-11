/**
 * FR-15: lifecycle controls on both legs, proven with real (failing) transactions.
 *   HTS mock USD: freeze the buyer -> buyer's transfer fails -> unfreeze; pause the token -> transfer fails -> unpause.
 *   ATS loan token: pause the security -> seller's transfer reverts -> unpause.
 * Every failed attempt has a transaction id on HashScan; the controls are restored at the end.
 *   npm run freeze-demo
 */
import { AccountId, PrivateKey, TokenFreezeTransaction, TokenId, TokenPauseTransaction, TokenUnfreezeTransaction, TokenUnpauseTransaction, TransferTransaction } from "@hashgraph/sdk";
import { JsonRpcProvider, Wallet } from "ethers";
import { hederaClient } from "./lib/client.js";
import { HASHSCAN, RPC_URL, requireEnv } from "./lib/env.js";
import { connectAts, sdk } from "./lib/ats.js";
import { diamond } from "./lib/diamond.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";

const dep = readDeployments();
const usd = TokenId.fromString(dep.mockUsd!.tokenId);
const buyer = dep.institutions!.find((i) => i.role === "buyer")!;
const seller = dep.institutions!.find((i) => i.role === "seller")!;
const lender = dep.institutions!.find((i) => i.role === "lender")!;
const buyerId = AccountId.fromString(buyer.accountId!);
const sellerId = AccountId.fromString(seller.accountId!);
const buyerKey = PrivateKey.fromStringECDSA(requireEnv("DESK_BUYER_PRIVATE_KEY"));
const client = hederaClient();
const results: Record<string, unknown> = {};

async function usdTransfer(label: string): Promise<string> {
  try {
    const tx = await (await new TransferTransaction().addTokenTransfer(usd, buyerId, -1_000_000).addTokenTransfer(usd, sellerId, 1_000_000).freezeWith(client).sign(buyerKey)).execute(client);
    const rc = await tx.getReceipt(client);
    console.log(`${label}: ${rc.status} ${HASHSCAN}/transaction/${tx.transactionId}`);
    return `${rc.status}`;
  } catch (e: any) {
    const id = e?.transactionId?.toString?.() ?? "";
    console.log(`${label}: BLOCKED ${e?.status ?? e?.message}${id ? ` ${HASHSCAN}/transaction/${id}` : ""}`);
    return `${e?.status ?? "failed"}${id ? ` ${id}` : ""}`;
  }
}

// HTS: account freeze.
await (await new TokenFreezeTransaction().setTokenId(usd).setAccountId(buyerId).execute(client)).getReceipt(client);
console.log(`buyer frozen on mUSD`);
results.usdFrozenTransfer = await usdTransfer("mUSD transfer while buyer frozen");
await (await new TokenUnfreezeTransaction().setTokenId(usd).setAccountId(buyerId).execute(client)).getReceipt(client);
console.log(`buyer unfrozen`);

// HTS: token pause (an amendment window, for example).
await (await new TokenPauseTransaction().setTokenId(usd).execute(client)).getReceipt(client);
console.log(`mUSD paused`);
results.usdPausedTransfer = await usdTransfer("mUSD transfer while token paused");
await (await new TokenUnpauseTransaction().setTokenId(usd).execute(client)).getReceipt(client);
console.log(`mUSD unpaused`);
results.usdRestoredTransfer = await usdTransfer("mUSD transfer after controls restored");

// ATS: pause the security; an otherwise valid seller -> lender transfer must revert.
const token = dep.loanToken!.evmAddress as string;
await connectAts();
const { Security, PauseRequest } = sdk;
await Security.pause(new PauseRequest({ securityId: token }));
console.log(`loan token paused (ATS)`);
const provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
const loan = diamond(token, new Wallet(requireEnv("DESK_SELLER_PRIVATE_KEY"), provider));
try {
  const tx = await loan.getFunction("transfer")(lender.evmAddress, 1000, { gasLimit: 1_000_000 });
  const rcpt = await tx.wait();
  console.log(`loan transfer while paused: status=${rcpt?.status} ${tx.hash} (UNEXPECTED)`);
  results.loanPausedTransfer = `status=${rcpt?.status} ${tx.hash}`;
} catch (e: any) {
  const hash = e?.receipt?.hash ?? e?.transactionHash ?? e?.transaction?.hash;
  console.log(`loan transfer while paused REVERTED${hash ? ` ${HASHSCAN}/transaction/${hash}` : ""}: ${(e?.shortMessage ?? e?.message ?? "").slice(0, 120)}`);
  results.loanPausedTransfer = `reverted${hash ? ` ${hash}` : ""}`;
}
await Security.unpause(new PauseRequest({ securityId: token }));
console.log(`loan token unpaused`);

writeDeployments((d) => { d.lifecycleControls = { ranAt: Date.now(), ...results }; });
console.log("recorded in deployments under lifecycleControls");
process.exit(0);
