/**
 * Issue the permissioned mock-USD payment token on HTS.
 *   - 6 decimals, treasury = administrative agent (operator)
 *   - KYC key: transfers only between KYC'd accounts (institutional cash restriction)
 *   - freeze / pause keys: lifecycle controls demonstrated in the UI
 *   - supply key: agent mints test balances for the demo institutions
 *   npx tsx src/deploy-mock-usd.ts
 */
import { TokenCreateTransaction, TokenSupplyType, TokenType } from "@hashgraph/sdk";
import { hederaClient, operatorId, operatorKey } from "./lib/client.js";
import { HASHSCAN } from "./lib/env.js";
import { writeDeployments, readDeployments } from "./lib/deployments.js";

const existing = readDeployments().mockUsd;
if (existing && !process.argv.includes("--force")) {
  console.log(`mock USD already deployed: ${existing.tokenId} (${existing.evmAddress}). Use --force to redeploy.`);
  process.exit(0);
}

const client = hederaClient();
const key = operatorKey();

const tx = await new TokenCreateTransaction()
  .setTokenName("SyndicateLend Mock USD")
  .setTokenSymbol("mUSD")
  .setTokenMemo("Synthetic permissioned payment token for SyndicateLend testnet demo. Not money.")
  .setTokenType(TokenType.FungibleCommon)
  .setDecimals(6)
  .setInitialSupply(0)
  .setSupplyType(TokenSupplyType.Infinite)
  .setTreasuryAccountId(operatorId())
  .setAdminKey(key.publicKey)
  .setSupplyKey(key.publicKey)
  .setKycKey(key.publicKey)
  .setFreezeKey(key.publicKey)
  .setPauseKey(key.publicKey)
  .setWipeKey(key.publicKey)
  .setFreezeDefault(false)
  .freezeWith(client)
  .sign(key);

const resp = await tx.execute(client);
const receipt = await resp.getReceipt(client);
const tokenId = receipt.tokenId!;
const evmAddress = "0x" + tokenId.toSolidityAddress();
const createTx = resp.transactionId.toString();

console.log(`mock USD token: ${tokenId}  evm ${evmAddress}`);
console.log(`${HASHSCAN}/token/${tokenId}`);
writeDeployments((d) => (d.mockUsd = { tokenId: tokenId.toString(), evmAddress, decimals: 6, symbol: "mUSD", createTx }));
client.close();
