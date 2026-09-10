/**
 * Resolve the operator's 0.0.x account id from its EVM address (the faucet auto-creates the
 * account on first HBAR transfer) and report its balance.
 *   npx tsx src/whoami.ts
 */
import { HASHSCAN, requireEnv } from "./lib/env.js";
import { accountIdForEvm, mirrorGet } from "./lib/mirror.js";
import { writeDeployments } from "./lib/deployments.js";

const evm = requireEnv("OPERATOR_EVM_ADDRESS");
const id = await accountIdForEvm(evm);
if (!id) {
  console.log(`No account exists yet for ${evm}.`);
  console.log(`Fund it at https://portal.hedera.com/faucet (paste the EVM address), then rerun.`);
  process.exit(1);
}
const acct = await mirrorGet<{ balance: { balance: number } }>(`/accounts/${id}`);
console.log(`Operator account: ${id}  (${evm})`);
console.log(`Balance: ${(acct.balance.balance / 1e8).toFixed(2)} HBAR`);
console.log(`${HASHSCAN}/account/${id}`);
writeDeployments((d) => (d.operator = { accountId: id, evmAddress: evm }));
if (process.env.OPERATOR_ACCOUNT_ID !== id) {
  console.log(`\nSet OPERATOR_ACCOUNT_ID=${id} in .env`);
}
