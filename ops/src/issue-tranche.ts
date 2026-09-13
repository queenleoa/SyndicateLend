/**
 * Issue one more asset under the credit agreement (a tranche, revolver or delayed-draw facility) as an
 * ATS bond-type security, configure it as a permissioned lender register exactly like the first tranche,
 * and allocate its opening syndicate pars. The asset is appended to deployments.assets[] so the web
 * register lists it beside the prepared tranche.
 *
 *   npm run issue-tranche -- --symbol MH-RCF --name "Meridian Holdings Revolving Credit Facility 2030" \
 *     --units 60000000 --maturity 2030-06-30 --rate 675 \
 *     --allocate 0xabc...:21000000,0xdef...:15000000
 *
 * Re-run with --resume <evmAddress> to continue allocations for an asset whose creation already succeeded.
 */
import { HASHSCAN, requireEnv } from "./lib/env.js";
import { connectAts, sdk, ATS_TESTNET } from "./lib/ats.js";
import { diamond, ROLES, send } from "./lib/diamond.js";
import { syntheticIsin } from "./lib/isin.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";
import { accountIdForEvm } from "./lib/mirror.js";

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith("--")) {
    if (fallback !== undefined) return fallback;
    throw new Error(`--${name} required`);
  }
  return process.argv[i + 1];
}

const symbol = arg("symbol").toUpperCase();
const name = arg("name");
const units = arg("units");
const maturityDate = arg("maturity");
const rateBps = Number(arg("rate", "725"));
const documentRef = arg("document", "ipfs://synthetic-credit-agreement-hash");
const resume = process.argv.includes("--resume") ? arg("resume") : null;
const allocations = arg("allocate", "").split(",").filter(Boolean).map((entry) => {
  const [evm, par] = entry.split(":");
  if (!/^0x[0-9a-fA-F]{40}$/.test(evm) || !/^[1-9]\d*$/.test(par)) throw new Error(`bad allocation ${entry}; use 0xaddress:par`);
  return { evmAddress: evm.toLowerCase(), par };
});
if (!/^[A-Z][A-Z0-9-]{1,11}$/.test(symbol)) throw new Error("symbol must be 2-12 letters, digits or hyphens");
if (!/^[1-9]\d*$/.test(units)) throw new Error("units must be a whole number of dollars");
const maturity = Math.floor(Date.parse(`${maturityDate}T00:00:00Z`) / 1000);
if (!Number.isFinite(maturity)) throw new Error("maturity must be YYYY-MM-DD");
const allocated = allocations.reduce((sum, a) => sum + BigInt(a.par), 0n);
if (allocated > BigInt(units)) throw new Error("allocations exceed the issued units");

const dep = readDeployments();
type Asset = { symbol: string; name: string; isin: string; decimals: number; units: string; maturity: number; documentRef: string; tokenId: string; evmAddress: string; createTx: string; startingDate: number; rateBps: number; issuedAt: string; allocations: { evmAddress: string; par: string; issueTx: string }[]; engineWhitelistTx?: string };
const assets = ((dep.assets as Asset[] | undefined) ??= []);
if (!resume && (assets.some((a) => a.symbol === symbol) || (dep.loanToken as { symbol?: string } | undefined)?.symbol === symbol)) throw new Error(`${symbol} is already issued`);

const { wallet } = await connectAts();
const agentEvm = wallet.address;
const { Bond, CreateBondRequest, Role, RoleRequest, Security, ControlListRequest, SsiManagement, AddIssuerRequest } = sdk;

let asset: Asset;
if (resume) {
  const found = assets.find((a) => a.evmAddress.toLowerCase() === resume.toLowerCase());
  if (!found) throw new Error(`no recorded asset at ${resume}`);
  asset = found;
  console.log(`resuming ${asset.symbol} at ${asset.evmAddress}`);
} else {
  const start = Math.floor(Date.now() / 1000) + 120;
  console.log(`Creating ATS bond-type security "${name}" (${symbol}, ${units} units) via factory ${ATS_TESTNET.factoryAddress} ...`);
  const res = await Bond.create(
    new CreateBondRequest({
      name, symbol, isin: syntheticIsin("XS", symbol.replace(/[^A-Z0-9]/g, "").padEnd(9, "0")), decimals: 0,
      isWhiteList: true, erc20VotesActivated: false, isControllable: true, arePartitionsProtected: false, isMultiPartition: false, clearingActive: false, internalKycActivated: true,
      currency: "0x555344", numberOfUnits: units, nominalValue: "1", nominalValueDecimals: 0,
      startingDate: String(start), maturityDate: String(maturity),
      regulationType: 1, regulationSubType: 0, isCountryControlListWhiteList: false, countries: "",
      info: `Synthetic syndicated loan asset under the Meridian Holdings credit agreement. Credit agreement ref: ${documentRef}`,
      configId: ATS_TESTNET.bondConfigId, configVersion: ATS_TESTNET.configVersion, diamondOwnerAccount: requireEnv("OPERATOR_ACCOUNT_ID"),
    }),
  );
  const evmAddress = String(res.security.evmDiamondAddress ?? "");
  if (!evmAddress) throw new Error(`no diamond address in response: ${JSON.stringify(res.security)}`);
  const tokenId = String(res.security.diamondAddress ?? (await accountIdForEvm(evmAddress)) ?? "");
  console.log(`security deployed: ${tokenId} ${evmAddress}  tx ${res.transactionId}\n${HASHSCAN}/contract/${tokenId}`);
  asset = { symbol, name, isin: syntheticIsin("XS", symbol.replace(/[^A-Z0-9]/g, "").padEnd(9, "0")), decimals: 0, units, maturity, documentRef, tokenId, evmAddress, createTx: String(res.transactionId), startingDate: start, rateBps, issuedAt: new Date().toISOString(), allocations: [] };
  writeDeployments((x) => { ((x.assets as Asset[] | undefined) ??= []).push(asset); });

  for (const [label, role] of Object.entries({ ISSUER: ROLES.ISSUER, KYC: ROLES.KYC, CONTROL_LIST: ROLES.CONTROL_LIST, PAUSER: ROLES.PAUSER, FREEZE_MANAGER: ROLES.FREEZE_MANAGER, CONTROLLER: ROLES.CONTROLLER, CORPORATE_ACTION: ROLES.CORPORATE_ACTION, SSI_MANAGER: ROLES.SSI_MANAGER, INTERNAL_KYC_MANAGER: ROLES.INTERNAL_KYC_MANAGER })) {
    const ok = await Role.grantRole(new RoleRequest({ securityId: evmAddress, targetId: agentEvm, role }));
    console.log(`role ${label} -> agent: ${ok?.payload ?? ok}`);
  }
  await SsiManagement.addIssuer(new AddIssuerRequest({ securityId: evmAddress, issuerId: agentEvm }));
  await Security.addToControlList(new ControlListRequest({ securityId: evmAddress, targetId: agentEvm }));
  const now = Math.floor(Date.now() / 1000);
  await send(diamond(evmAddress), "grantKyc", [agentEvm, "kyc:agent", now, now + 5 * 365 * 24 * 3600, agentEvm]);
  console.log("agent registered as SSI issuer, whitelisted and KYC granted");
}

const d = diamond(asset.evmAddress);
if (dep.settlementEngine?.address && !asset.engineWhitelistTx) {
  await Security.addToControlList(new ControlListRequest({ securityId: asset.evmAddress, targetId: dep.settlementEngine.address }));
  asset.engineWhitelistTx = "done";
  writeDeployments((x) => { const list = x.assets as Asset[]; list[list.findIndex((a) => a.symbol === asset.symbol)] = asset; });
  console.log(`settlement engine whitelisted: ${dep.settlementEngine.address}`);
}

for (const allocation of allocations) {
  if (asset.allocations.some((a) => a.evmAddress === allocation.evmAddress)) { console.log(`already allocated to ${allocation.evmAddress}`); continue; }
  const now = Math.floor(Date.now() / 1000);
  await send(d, "addToControlList", [allocation.evmAddress], 1_000_000);
  await send(d, "grantKyc", [allocation.evmAddress, `kyc:${allocation.evmAddress.slice(2, 10)}`, now, now + 5 * 365 * 24 * 3600, agentEvm]);
  const issued = await send(d, "issue", [allocation.evmAddress, BigInt(allocation.par), "0x"]);
  asset.allocations.push({ evmAddress: allocation.evmAddress, par: allocation.par, issueTx: issued.hash });
  writeDeployments((x) => { const list = x.assets as Asset[]; list[list.findIndex((a) => a.symbol === asset.symbol)] = asset; });
  console.log(`allocated ${allocation.par} par to ${allocation.evmAddress}: ${HASHSCAN}/transaction/${issued.hash}`);
}
const supply = await d.getFunction("totalSupply")();
console.log(`done: ${asset.symbol} total supply ${supply} of ${asset.units}  ${HASHSCAN}/contract/${asset.tokenId}`);
process.exit(0);
