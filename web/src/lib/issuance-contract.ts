import { getAddress, Interface, ZeroAddress, ZeroHash } from "ethers";
import factoryArtifact from "@hashgraph/asset-tokenization-contracts/artifacts/contracts/factory/Factory.sol/Factory.json";
import assetArtifact from "@hashgraph/asset-tokenization-contracts/artifacts/contracts/facets/IAsset.sol/IAsset.json";
import type { IssuanceTerms } from "./issuance-spec";

export const factoryInterface = new Interface(factoryArtifact.abi);
export const assetInterface = new Interface(assetArtifact.abi);
export const BOND_CONFIG_ID = `0x${"0".repeat(63)}2`;
export const DEFAULT_PARTITION = `0x${"0".repeat(63)}1`;
// ATS 8.0.0 constants/roles.sol, also used by ops/src/lib/diamond.ts.
const ROLE = {
  issuer: "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f",
  controlList: "0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d",
  kyc: "0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc",
  internalKyc: "0xdd78fdcd1b38a5360405cef8d91e758ad0f42bf2ced681b803b3c2704b0a32a7",
  ssi: "0x3120494a82251fe85b0403877539486dbfcf0f94c20741a3229cfad31f625ee1",
  corporateAction: "0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd",
  pauser: "0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f",
  freeze: "0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155",
  controller: "0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e",
};

/** ATS resolver calls require the canonical EVM alias, not a long-zero address synthesized from the ID. */
export async function resolveAtsAddress(value: string, mirrorUrl: string, fetcher: typeof fetch = fetch) {
  if (!/^0\.0\.[0-9]+$/.test(value)) return getAddress(value);
  const response = await fetcher(`${mirrorUrl}/api/v1/contracts/${value}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Could not resolve the ATS contract's canonical EVM address.");
  const contract = await response.json() as { contract_id?: string; evm_address?: string };
  if (contract.contract_id !== value || !contract.evm_address) throw new Error("Mirror node returned a different or incomplete ATS contract.");
  return getAddress(contract.evm_address);
}

export function encodeLoanCreation(terms: IssuanceTerms, agent: string, resolver: string, isin: string, startingDate: number) {
  const roles = [ZeroHash, ROLE.issuer, ROLE.controlList, ROLE.kyc, ROLE.internalKyc, ROLE.ssi, ROLE.corporateAction];
  if (terms.pauser) roles.push(ROLE.pauser);
  if (terms.freezeManager) roles.push(ROLE.freeze);
  if (terms.controller) roles.push(ROLE.controller);
  return factoryInterface.encodeFunctionData("deployBond", [{
    security: {
      resolver,
      maxSupply: terms.principal,
      resolverProxyConfiguration: { key: BOND_CONFIG_ID, version: 1 },
      erc20MetadataInfo: { name: terms.name, symbol: terms.symbol, isin, decimals: 0 },
      rbacs: roles.map((role) => ({ role, members: [agent] })),
      externalPauses: [], externalControlLists: [], externalKycLists: [],
      compliance: ZeroAddress, identityRegistry: ZeroAddress,
      arePartitionsProtected: false, isMultiPartition: false, isControllable: terms.controller,
      isWhiteList: true, clearingActive: false, internalKycActivated: true, erc20VotesActivated: false,
    },
    bondDetails: { currency: "0x555344", nominalValue: "1", nominalValueDecimals: 0, startingDate, maturityDate: Math.floor(Date.parse(`${terms.maturityDate}T00:00:00Z`) / 1000) },
    proceedRecipients: [], proceedRecipientsData: [],
  }, {
    regulationType: 1, regulationSubType: 0,
    additionalSecurityData: { countriesControlListType: false, listOfCountries: "", info: `Synthetic syndicated loan tranche. Agreement reference: ${terms.documentRef || "Not provided"}` },
  }]);
}
