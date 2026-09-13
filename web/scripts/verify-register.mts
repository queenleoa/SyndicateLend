/** Read-only check of the register model: assets, holder directory and live balances. */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { hydrate } = await import("../src/lib/store");
await hydrate();
const { listAssets, holderDirectory, assetBalances, creditAgreement, readDeployment } = await import("../src/lib/assets");
const { readDistribution, readPayout, evidenceFor } = await import("../src/lib/register-interest");
const { notices } = await import("../src/lib/notices");
const dep = readDeployment();
console.log("agreement:", creditAgreement(dep).name);
const assets = await listAssets(dep);
const directory = holderDirectory(dep);
const wallets = [...new Set(directory.flatMap((h) => h.wallets))];
for (const a of assets) {
  const { balances, totalSupply } = await assetBalances(a, wallets, dep);
  const lines = directory.map((h) => ({ name: h.name, par: h.wallets.reduce((s, w) => s + (balances.get(w) ?? 0n), 0n) })).filter((x) => x.par > 0n);
  console.log(`\n${a.symbol} (${a.source}) ${a.name} supply=${totalSupply} principal=${a.principal} token=${a.tokenId ?? a.evmAddress}`);
  for (const l of lines) console.log(`   ${l.name.padEnd(48)} ${l.par.toString().padStart(12)}`);
  const d = readDistribution(a.symbol); const p = readPayout(a.symbol, d?.commitment ?? null); const e = evidenceFor(a.symbol, d);
  const n = notices.read().notices.filter((x) => x.facilityId === a.symbol).length;
  console.log(`   interest: notices ${n} | released ${d ? `${d.totalUnits} units (period ${d.periodId})` : "none"} | CRE verified ${e.verified} | paid ${p ? p.paid.reduce((sum, x) => sum + BigInt(x.amountUnits), 0n).toString() : "none"}`);
}
process.exit(0);
