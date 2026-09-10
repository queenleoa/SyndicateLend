/**
 * Grant or revoke an institution's eligibility to hold the loan tranche:
 * control-list (whitelist) membership + internal KYC on the ATS security.
 *   npx tsx src/set-eligibility.ts --evm 0x... --grant
 *   npx tsx src/set-eligibility.ts --evm 0x... --revoke
 */
import { HASHSCAN } from "./lib/env.js";
import { connectAts, sdk } from "./lib/ats.js";
import { diamond, send } from "./lib/diamond.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";

const evmArg = process.argv[process.argv.indexOf("--evm") + 1];
if (!evmArg) throw new Error("--evm required");
const evm = evmArg.toLowerCase();
const grant = process.argv.includes("--grant");
const revoke = process.argv.includes("--revoke");
if (grant === revoke) throw new Error("pass exactly one of --grant / --revoke");

const dep = readDeployments();
if (!dep.loanToken) throw new Error("issue the loan token first");
const token = dep.loanToken.evmAddress as string;

const { wallet } = await connectAts();
const { Security, ControlListRequest, Kyc, GetKycStatusForRequest } = sdk;
const d = diamond(token);

if (grant) {
  await Security.addToControlList(new ControlListRequest({ securityId: token, targetId: evm }));
  const now = Math.floor(Date.now() / 1000);
  const r = await send(d, "grantKyc", [evm, `kyc:${evm.slice(2, 10)}`, now, now + 365 * 24 * 3600, wallet.address]);
  console.log(`eligibility granted to ${evm}: whitelist + KYC (${r.hash})`);
} else {
  const r = await send(d, "revokeKyc", [evm]);
  await Security.removeFromControlList(new ControlListRequest({ securityId: token, targetId: evm }));
  console.log(`eligibility revoked for ${evm}: KYC revoked (${r.hash}) + removed from whitelist`);
}
const status = await Kyc.getKycStatusFor(new GetKycStatusForRequest({ securityId: token, targetId: evm }));
console.log(`KYC status now: ${JSON.stringify(status)}  ${HASHSCAN}/contract/${dep.loanToken.tokenId}`);

writeDeployments((x) => {
  const inst = (x.institutions ?? []).find((i) => i.evmAddress.toLowerCase() === evm);
  if (inst) inst.loanEligible = grant;
});
