/**
 * Allocate loan tokens to an eligible lender in proportion to its opening principal position.
 *   npx tsx src/allocate.ts --evm 0x... --par 50000000
 */
import { HASHSCAN } from "./lib/env.js";
import { connectAts, sdk } from "./lib/ats.js";
import { readDeployments } from "./lib/deployments.js";

const evm = process.argv[process.argv.indexOf("--evm") + 1];
const par = process.argv[process.argv.indexOf("--par") + 1];
if (!evm || !par) throw new Error("--evm and --par required");

const dep = readDeployments();
if (!dep.loanToken) throw new Error("issue the loan token first");
const token = dep.loanToken.evmAddress as string;

await connectAts();
const { Security, IssueRequest, GetAccountBalanceRequest } = sdk;
const res = await Security.issue(new IssueRequest({ securityId: token, targetId: evm, amount: par }));
console.log(`issued ${par} par units to ${evm}: ${JSON.stringify(res)}`);
const bal = await Security.getBalanceOf(new GetAccountBalanceRequest({ securityId: token, targetId: evm }));
console.log(`balance: ${JSON.stringify(bal)}  ${HASHSCAN}/contract/${dep.loanToken.tokenId}`);
