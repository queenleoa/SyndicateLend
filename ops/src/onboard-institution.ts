/**
 * Onboard a demo institution identified by an EVM address (a Privy desk wallet, MetaMask, or a
 * locally generated key):
 *   1. transfer HBAR (auto-creates the account if needed, with unlimited auto-associations)
 *   2. grant mock-USD KYC
 *   3. transfer an opening mock-USD balance from the agent treasury
 *   npx tsx src/onboard-institution.ts --name "Meridian Credit" --role buyer --evm 0x... --usd 10000000 [--key 0x...]
 *
 * KYC can only be granted to an account that is associated with the token. With --key (the desk's
 * own ECDSA key) the script signs a TokenAssociateTransaction on the desk's behalf, which also
 * completes the hollow account. Without --key the desk must associate itself first (e.g. by
 * calling the token's IHRC719 `associate()` facade from its wallet) and the script is re-run.
 */
import {
  AccountId,
  Hbar,
  PrivateKey,
  TokenAssociateTransaction,
  TokenGrantKycTransaction,
  TokenId,
  TokenMintTransaction,
  TransferTransaction,
} from "@hashgraph/sdk";
import { hederaClient, operatorId, operatorKey } from "./lib/client.js";
import { HASHSCAN } from "./lib/env.js";
import { accountIdForEvm, waitFor } from "./lib/mirror.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) {
    if (def !== undefined) return def;
    throw new Error(`--${name} required`);
  }
  return process.argv[i + 1];
}

const name = arg("name");
const role = arg("role", "lender");
const evm = arg("evm").toLowerCase();
const usdWhole = BigInt(arg("usd", "0"));
const hbar = Number(arg("hbar", "20"));
const skipKyc = process.argv.includes("--no-kyc");
const deskKeyHex = arg("key", "");

const d = readDeployments();
if (!d.mockUsd) throw new Error("deploy mock USD first");
const usd = TokenId.fromString(d.mockUsd.tokenId);
const client = hederaClient();
const key = operatorKey();

// 1. Fund (auto-creates a hollow account for a fresh EVM address).
let accountId = await accountIdForEvm(evm);
if (!accountId) {
  console.log(`creating account for ${evm} with ${hbar} HBAR`);
  const resp = await new TransferTransaction()
    .addHbarTransfer(operatorId(), new Hbar(-hbar))
    .addHbarTransfer(AccountId.fromEvmAddress(0, 0, evm), new Hbar(hbar))
    .execute(client);
  await resp.getReceipt(client);
  accountId = await waitFor(() => accountIdForEvm(evm), "account creation on mirror");
} else if (hbar > 0) {
  const resp = await new TransferTransaction()
    .addHbarTransfer(operatorId(), new Hbar(-hbar))
    .addHbarTransfer(AccountId.fromString(accountId), new Hbar(hbar))
    .execute(client);
  await resp.getReceipt(client);
}
console.log(`${name}: account ${accountId}  ${HASHSCAN}/account/${accountId}`);

// 2. Associate the desk with the payment token (requires the desk's signature), then grant KYC.
let usdKyc = false;
if (!skipKyc) {
  const assocInfo = await fetch(`${process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com"}/api/v1/accounts/${accountId}/tokens?token.id=${usd.toString()}`).then((r) => r.json());
  const associated = Array.isArray(assocInfo.tokens) && assocInfo.tokens.length > 0;
  if (!associated) {
    if (!deskKeyHex) throw new Error(`${accountId} is not associated with ${usd}; pass --key or associate from the wallet first`);
    const deskKey = PrivateKey.fromStringECDSA(deskKeyHex);
    const assoc = await (
      await new TokenAssociateTransaction().setAccountId(AccountId.fromString(accountId)).setTokenIds([usd]).freezeWith(client).sign(deskKey)
    ).execute(client);
    const rc = await assoc.getReceipt(client);
    console.log(`mUSD associated: ${rc.status.toString()}  tx ${assoc.transactionId}`);
  }
  const tx = await new TokenGrantKycTransaction()
    .setAccountId(AccountId.fromString(accountId))
    .setTokenId(usd)
    .freezeWith(client)
    .sign(key);
  const resp = await tx.execute(client);
  const rc = await resp.getReceipt(client);
  console.log(`mUSD KYC granted: ${rc.status.toString()}  tx ${resp.transactionId}`);
  usdKyc = true;
}

// 3. Opening cash balance (mint to treasury, then transfer; receiver auto-associates).
if (usdWhole > 0n && usdKyc) {
  const units = usdWhole * 1_000_000n;
  const mint = await (await new TokenMintTransaction().setTokenId(usd).setAmount(units).freezeWith(client).sign(key)).execute(client);
  await mint.getReceipt(client);
  const xfer = await new TransferTransaction()
    .addTokenTransfer(usd, operatorId(), -units)
    .addTokenTransfer(usd, AccountId.fromString(accountId), units)
    .execute(client);
  const rc = await xfer.getReceipt(client);
  console.log(`mUSD ${usdWhole.toLocaleString()} transferred: ${rc.status.toString()}  tx ${xfer.transactionId}`);
}

writeDeployments((dep) => {
  dep.institutions = (dep.institutions ?? []).filter((i) => i.evmAddress.toLowerCase() !== evm);
  dep.institutions.push({ name, role, evmAddress: evm, accountId: accountId!, usdKyc });
});
client.close();
