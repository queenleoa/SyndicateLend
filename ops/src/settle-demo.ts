/**
 * End-to-end atomic settlement on testnet:
 *   1. seller authorises the engine on the ATS tranche (approve)
 *   2. buyer authorises the engine on mock USD (ERC-20 facade approve)
 *   3. venue (agent) creates the settlement instruction from an accepted RFQ
 *   4. buyer desk and seller desk approve the instruction hash
 *   5. the second approval schedules settle(tradeId) on the Hedera Schedule Service
 *   6. wait for the network to execute it, then compare balances
 *   npx tsx src/settle-demo.ts [--par 5000000] [--price 99.00] [--delay 120] [--manual] [--revoke-buyer]
 *
 * --revoke-buyer: after both desks approve, the compliance officer revokes the buyer's eligibility
 * on the tranche. The scheduled settlement must then fail completely (no leg moves) and the trade
 * records the ATS revert reason. Eligibility is restored afterwards.
 */
import { execFileSync } from "node:child_process";
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { createRequire } from "node:module";
import { HASHSCAN, RPC_URL, requireEnv } from "./lib/env.js";
import { diamond } from "./lib/diamond.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";

const require = createRequire(import.meta.url);
const engineAbi = require("../../contracts/out/SettlementEngine.sol/SettlementEngine.json").abi;
const erc20Abi = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address a) view returns (uint256)",
];

function arg(name: string, def: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
}
const par = BigInt(arg("par", "5000000"));
const price = Number(arg("price", "99.00"));
const delay = Number(arg("delay", "120"));
const manual = process.argv.includes("--manual");
const revokeBuyer = process.argv.includes("--revoke-buyer");
const cash = (par * BigInt(Math.round(price * 100)) * 1_000_000n) / 10_000n; // 6dp USD

const dep = readDeployments();
const provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true });
const agent = new Wallet(requireEnv("OPERATOR_PRIVATE_KEY"), provider);
const seller = new Wallet(requireEnv("DESK_SELLER_PRIVATE_KEY"), provider);
const buyer = new Wallet(requireEnv("DESK_BUYER_PRIVATE_KEY"), provider);
const engineAddr = dep.settlementEngine!.address;
const loanAddr = dep.loanToken!.evmAddress as string;
const usdAddr = dep.mockUsd!.evmAddress;

const engine = new Contract(engineAddr, engineAbi, agent);
const loanAsSeller = diamond(loanAddr, seller);
const usdAsBuyer = new Contract(usdAddr, erc20Abi, buyer);
const loanView = diamond(loanAddr, provider);
const usdView = new Contract(usdAddr, erc20Abi, provider);

async function balances(label: string) {
  const [ls, lb, us, ub] = await Promise.all([
    loanView.getFunction("balanceOf")(seller.address),
    loanView.getFunction("balanceOf")(buyer.address),
    usdView.balanceOf(seller.address),
    usdView.balanceOf(buyer.address),
  ]);
  console.log(`${label}: seller loan=${ls} usd=${Number(us) / 1e6}  |  buyer loan=${lb} usd=${Number(ub) / 1e6}`);
  return { ls, lb, us, ub };
}
const before = await balances("before");

// 1 + 2: leg authorisations (only if needed)
if ((await loanView.getFunction("allowance")(seller.address, engineAddr)) < par) {
  const tx = await loanAsSeller.getFunction("approve")(engineAddr, par, { gasLimit: 1_000_000 });
  await tx.wait();
  console.log(`seller approved loan leg: ${HASHSCAN}/transaction/${tx.hash}`);
}
if ((await usdView.allowance(buyer.address, engineAddr)) < cash) {
  const tx = await usdAsBuyer.approve(engineAddr, cash, { gasLimit: 1_000_000 });
  await tx.wait();
  console.log(`buyer approved cash leg: ${HASHSCAN}/transaction/${tx.hash}`);
}

// 3: instruction from the accepted RFQ
const now = Math.floor(Date.now() / 1000);
const instruction = {
  loanToken: loanAddr,
  cashToken: usdAddr,
  buyer: buyer.address,
  seller: seller.address,
  par,
  cash,
  settleAt: now + delay,
  expiresAt: now + 3600,
  rfqRef: keccak256(toUtf8Bytes(`rfq-demo-${now}`)),
};
const createTx = await engine.createTrade(instruction, { gasLimit: 1_000_000 });
const createRcpt = await createTx.wait();
const created = createRcpt.logs.map((l: any) => { try { return engine.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "TradeCreated");
const tradeId: bigint = created.args.tradeId;
const hash: string = created.args.instructionHash;
console.log(`trade #${tradeId} created, par ${par} @ ${price} = ${Number(cash) / 1e6} mUSD, settleAt +${delay}s  ${HASHSCAN}/transaction/${createTx.hash}`);

// 4 + 5: desk approvals (second one schedules through HSS)
const buyerApprove = await (engine.connect(buyer) as Contract).approve(tradeId, hash, { gasLimit: 1_000_000 });
await buyerApprove.wait();
console.log(`buyer desk approved  ${HASHSCAN}/transaction/${buyerApprove.hash}`);
const sellerApprove = await (engine.connect(seller) as Contract).approve(tradeId, hash, { gasLimit: 2_000_000 });
const sellerRcpt = await sellerApprove.wait();
const evs = sellerRcpt.logs.map((l: any) => { try { return engine.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
const scheduled = evs.find((e: any) => e.name === "TradeScheduled");
const unavailable = evs.find((e: any) => e.name === "ScheduleUnavailable");
console.log(`seller desk approved  ${HASHSCAN}/transaction/${sellerApprove.hash}`);
if (scheduled) console.log(`scheduled via HSS: schedule ${scheduled.args.scheduleAddress}  ${HASHSCAN}/schedule/${scheduled.args.scheduleAddress}`);
if (unavailable) console.log(`HSS scheduling unavailable (rc=${unavailable.args.responseCode}); settle() must be called manually after settleAt`);

writeDeployments((d) => {
  (d as any).trades = [...(((d as any).trades as any[]) ?? []), { tradeId: tradeId.toString(), hash, instruction: { ...instruction, par: par.toString(), cash: cash.toString() }, scheduleAddress: scheduled?.args.scheduleAddress ?? null, createTx: createTx.hash }];
});

if (revokeBuyer) {
  console.log("compliance officer revokes buyer eligibility before settlement ...");
  execFileSync("npx", ["tsx", "src/set-eligibility.ts", "--evm", buyer.address, "--revoke"], { stdio: "inherit" });
}

// 6: wait for execution
const stateName = ["None", "AwaitingApprovals", "Scheduled", "Settled", "Failed", "Cancelled"];
const deadline = instruction.settleAt + 90;
let t = await engine.getTrade(tradeId);
while (Number(t.state) === 2 && Math.floor(Date.now() / 1000) < deadline && !manual) {
  await new Promise((r) => setTimeout(r, 10_000));
  t = await engine.getTrade(tradeId);
  process.stdout.write(`  state=${stateName[Number(t.state)]} t-${instruction.settleAt - Math.floor(Date.now() / 1000)}s\n`);
}
if (Number(t.state) === 2) {
  console.log(manual ? "manual mode: calling settle()" : "schedule did not execute in time; calling settle() manually");
  while (Math.floor(Date.now() / 1000) < instruction.settleAt) await new Promise((r) => setTimeout(r, 5000));
  const tx = await engine.settle(tradeId, { gasLimit: 3_000_000 });
  await tx.wait();
  console.log(`manual settle tx ${HASHSCAN}/transaction/${tx.hash}`);
  t = await engine.getTrade(tradeId);
}
console.log(`final state: ${stateName[Number(t.state)]}`);
if (Number(t.state) === 4) {
  const reason: string = t.failureReason;
  let decoded = reason;
  try { decoded = loanView.interface.parseError(reason)?.signature ?? reason; } catch {}
  console.log(`  failure reason (on-chain): ${decoded}  raw=${reason.slice(0, 74)}...`);
}
const after = await balances("after");
if (revokeBuyer) {
  const unchanged = after.lb === before.lb && after.ls === before.ls && after.us === before.us && after.ub === before.ub;
  console.log(unchanged && Number(t.state) === 4 ? "FULL REVERT VERIFIED: trade Failed, no balance changed" : "unexpected outcome");
  console.log("restoring buyer eligibility ...");
  execFileSync("npx", ["tsx", "src/set-eligibility.ts", "--evm", buyer.address, "--grant"], { stdio: "inherit" });
  process.exit(0);
}
const ok = BigInt(after.lb) - BigInt(before.lb) === par && BigInt(before.ls) - BigInt(after.ls) === par && BigInt(after.us) - BigInt(before.us) === cash && BigInt(before.ub) - BigInt(after.ub) === cash;
console.log(ok ? "ATOMIC SETTLEMENT VERIFIED: both legs moved together" : "balances did not move as expected");
