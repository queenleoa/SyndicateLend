/**
 * Distribute an asset's agent-held principal to syndicate lenders: whitelist + KYC each lender on that
 * security, then transfer par from the agent bank's holding account. Also whitelists the settlement engine.
 *   npm run allocate-asset -- --asset 0x94cf... --allocate 0xabc...:10000000,0xdef...:8000000
 */
import { Contract } from "ethers";
import { HASHSCAN } from "./lib/env.js";
import { diamond, operatorWallet, send } from "./lib/diamond.js";
import { readDeployments } from "./lib/deployments.js";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith("--")) { if (fallback !== undefined) return fallback; throw new Error(`--${name} required`); }
  return process.argv[i + 1];
}
const asset = arg("asset");
const allocations = arg("allocate").split(",").filter(Boolean).map((entry) => {
  const [evm, par] = entry.split(":");
  if (!/^0x[0-9a-fA-F]{40}$/.test(evm) || !/^[1-9]\d*$/.test(par)) throw new Error(`bad allocation ${entry}`);
  return { evmAddress: evm.toLowerCase(), par: BigInt(par) };
});
const dep = readDeployments();
const agent = operatorWallet();
const d = diamond(asset);
const erc20 = new Contract(asset, ["function balanceOf(address) view returns (uint256)", "function transfer(address,uint256) returns (bool)", "function isInControlList(address) view returns (bool)"], agent);
const held: bigint = await erc20.balanceOf(agent.address);
const total = allocations.reduce((sum, a) => sum + a.par, 0n);
if (total > held) throw new Error(`agent holds ${held} but ${total} requested`);
if (dep.settlementEngine?.address && !(await erc20.isInControlList(dep.settlementEngine.address).catch(() => false))) {
  await send(d, "addToControlList", [dep.settlementEngine.address], 1_000_000);
  console.log(`settlement engine whitelisted on ${asset}`);
}
for (const a of allocations) {
  const now = Math.floor(Date.now() / 1000);
  if (!(await erc20.isInControlList(a.evmAddress).catch(() => false))) await send(d, "addToControlList", [a.evmAddress], 1_000_000);
  const kyc: bigint = await d.getFunction("getKycStatusFor")(a.evmAddress).catch(() => 0n);
  if (Number(kyc) !== 1) await send(d, "grantKyc", [a.evmAddress, `kyc:${a.evmAddress.slice(2, 10)}`, now, now + 5 * 365 * 24 * 3600, agent.address]);
  const tx = await erc20.transfer(a.evmAddress, a.par, { gasLimit: 1_500_000 });
  const rc = await tx.wait();
  if (!rc || rc.status !== 1) throw new Error(`transfer to ${a.evmAddress} failed: ${tx.hash}`);
  console.log(`transferred ${a.par} par to ${a.evmAddress}: ${HASHSCAN}/transaction/${tx.hash}`);
}
console.log(`agent now holds ${await erc20.balanceOf(agent.address)} of ${asset}`);
process.exit(0);
