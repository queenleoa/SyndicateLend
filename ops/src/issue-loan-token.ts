/**
 * Issue the facility tranche as an ATS bond-type security (a term loan is debt with a maturity and
 * periodic interest), then configure it as a permissioned lender register:
 *   - whitelist control list + internal KYC (both sender and receiver checked on every transfer)
 *   - the administrative agent holds issuer / KYC / control-list / pauser / freeze roles
 *   - the agent is registered as the SSI issuer so it can grant KYC directly
 *   - the SettlementEngine is whitelisted so it may act as the transfer sender in DvP
 *   npx tsx src/issue-loan-token.ts
 */
import { HASHSCAN, requireEnv } from "./lib/env.js";
import { connectAts, sdk, ATS_TESTNET } from "./lib/ats.js";
import { diamond, ROLES, send } from "./lib/diamond.js";
import { syntheticIsin } from "./lib/isin.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";
import { accountIdForEvm } from "./lib/mirror.js";

const FACILITY = {
  name: "Meridian Holdings Term Loan B 2031 - Tranche A",
  symbol: "MHTLB-A",
  isin: syntheticIsin("XS", "MHTLB2031A"),
  decimals: 0, // 1 token = US$1 of par
  units: "250000000", // US$250m tranche
  maturity: Math.floor(Date.UTC(2031, 5, 30) / 1000), // 30 Jun 2031
  documentRef: "ipfs://synthetic-credit-agreement-hash", // reference only; never the document
};

const dep = readDeployments();
if (dep.loanToken && !process.argv.includes("--force")) {
  console.log(`loan token already issued: ${JSON.stringify(dep.loanToken)}. Use --force to reissue.`);
  process.exit(0);
}

const { wallet } = await connectAts();
const agentEvm = wallet.address;
const { Bond, CreateBondRequest, Role, RoleRequest, Security, ControlListRequest, Kyc, GetKycStatusForRequest, SsiManagement, AddIssuerRequest } = sdk;

console.log(`Creating ATS bond-type security "${FACILITY.name}" via factory ${ATS_TESTNET.factoryAddress} ...`);
const start = Math.floor(Date.now() / 1000) + 120;
const res = await Bond.create(
  new CreateBondRequest({
    name: FACILITY.name,
    symbol: FACILITY.symbol,
    isin: FACILITY.isin,
    decimals: FACILITY.decimals,
    isWhiteList: true,
    erc20VotesActivated: false,
    isControllable: true,
    arePartitionsProtected: false,
    isMultiPartition: false,
    clearingActive: false,
    internalKycActivated: true,
    currency: "0x555344", // USD
    numberOfUnits: FACILITY.units,
    nominalValue: "1",
    nominalValueDecimals: 0,
    startingDate: String(start),
    maturityDate: String(FACILITY.maturity),
    regulationType: 1, // Regulation S: offshore institutional offering (NONE is rejected by the SDK)
    regulationSubType: 0,
    isCountryControlListWhiteList: false,
    countries: "",
    info: `Synthetic syndicated term-loan tranche for SyndicateLend demo. Credit agreement ref: ${FACILITY.documentRef}`,
    configId: ATS_TESTNET.bondConfigId,
    configVersion: ATS_TESTNET.configVersion,
    diamondOwnerAccount: requireEnv("OPERATOR_ACCOUNT_ID"),
  }),
);
const security = res.security;
const evmAddress: string = String(security.evmDiamondAddress ?? "");
const tokenId: string = String(security.diamondAddress ?? (await accountIdForEvm(evmAddress)) ?? "");
if (!evmAddress) throw new Error(`no diamond address in response: ${JSON.stringify(security)}`);
console.log(`security deployed: ${tokenId} ${evmAddress}  tx ${res.transactionId}`);
console.log(`${HASHSCAN}/contract/${tokenId}`);

// Agent roles (the diamond owner has DEFAULT_ADMIN_ROLE and grants the operational roles).
for (const [label, role] of Object.entries({
  ISSUER: ROLES.ISSUER,
  KYC: ROLES.KYC,
  CONTROL_LIST: ROLES.CONTROL_LIST,
  PAUSER: ROLES.PAUSER,
  FREEZE_MANAGER: ROLES.FREEZE_MANAGER,
  CONTROLLER: ROLES.CONTROLLER,
  CORPORATE_ACTION: ROLES.CORPORATE_ACTION,
  SSI_MANAGER: ROLES.SSI_MANAGER,
  INTERNAL_KYC_MANAGER: ROLES.INTERNAL_KYC_MANAGER,
})) {
  const ok = await Role.grantRole(new RoleRequest({ securityId: evmAddress, targetId: agentEvm, role }));
  console.log(`role ${label} -> agent: ${ok?.payload ?? ok}`);
}

// Register the agent as a KYC credential issuer (required by the KYC facet's onlyValidIssuer).
const d = diamond(evmAddress);
await SsiManagement.addIssuer(new AddIssuerRequest({ securityId: evmAddress, issuerId: agentEvm }));
console.log(`agent registered as SSI issuer`);

// Whitelist the agent (treasury / issuance sender) and grant it KYC so it can hold the tranche.
await Security.addToControlList(new ControlListRequest({ securityId: evmAddress, targetId: agentEvm }));
const now = Math.floor(Date.now() / 1000);
await send(d, "grantKyc", [agentEvm, "kyc:agent", now, now + 5 * 365 * 24 * 3600, agentEvm]);
console.log(`agent whitelisted + KYC granted`);

// Whitelist the settlement engine if already deployed (it is the transferFrom sender in DvP).
if (dep.settlementEngine?.address) {
  await Security.addToControlList(new ControlListRequest({ securityId: evmAddress, targetId: dep.settlementEngine.address }));
  console.log(`settlement engine whitelisted: ${dep.settlementEngine.address}`);
}

const status = await Kyc.getKycStatusFor(new GetKycStatusForRequest({ securityId: evmAddress, targetId: agentEvm }));
console.log(`agent KYC status: ${JSON.stringify(status)}`);

writeDeployments((x) => {
  x.loanToken = {
    ...FACILITY,
    tokenId,
    evmAddress,
    createTx: res.transactionId,
    configId: ATS_TESTNET.bondConfigId,
    factory: ATS_TESTNET.factoryAddress,
    resolver: ATS_TESTNET.resolverAddress,
    startingDate: start,
  };
});
console.log("done");
