/**
 * Direct ethers access to an ATS security diamond for the few operations the SDK cannot perform
 * from a backend without a Terminal3 verifiable credential (internal KYC grants), plus reads.
 * ABI comes from the ATS contracts package so it always matches the deployed facets.
 */
import { createRequire } from "node:module";
import { Contract, JsonRpcProvider, Wallet, type ContractRunner } from "ethers";
import { RPC_URL, requireEnv } from "./env.js";

const require = createRequire(import.meta.url);
const artifact = require("@hashgraph/asset-tokenization-contracts/artifacts/contracts/facets/IAsset.sol/IAsset.json");

/** Role hashes from ATS v8 contracts/constants/roles.sol */
export const ROLES = {
  DEFAULT_ADMIN: "0x0000000000000000000000000000000000000000000000000000000000000000",
  ISSUER: "0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f",
  CONTROLLER: "0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e",
  CONTROL_LIST: "0x6ed9a91e996c6475ecdc28ecbdbe9bd1122fc62b30cdbe6da8271884b51ec74d",
  CORPORATE_ACTION: "0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd",
  FREEZE_MANAGER: "0x71ae38482e1ab1c28e767d64766d686215b490c8c1bd7dfe6b101525187c2155",
  INTERNAL_KYC_MANAGER: "0xdd78fdcd1b38a5360405cef8d91e758ad0f42bf2ced681b803b3c2704b0a32a7",
  KYC: "0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc",
  PAUSER: "0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f",
  SSI_MANAGER: "0x3120494a82251fe85b0403877539486dbfcf0f94c20741a3229cfad31f625ee1",
} as const;

export enum KycStatus {
  NOT_GRANTED = 0,
  GRANTED = 1,
}

export function operatorWallet(): Wallet {
  return new Wallet(requireEnv("OPERATOR_PRIVATE_KEY"), new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true }));
}

export function diamond(address: string, runner: ContractRunner = operatorWallet()): Contract {
  return new Contract(address, artifact.abi, runner);
}

/** Send a diamond tx with an explicit gas limit (Hedera's relay under-estimates diamond calls). */
export async function send(c: Contract, fn: string, args: unknown[], gasLimit = 1_500_000) {
  const tx = await c.getFunction(fn)(...args, { gasLimit });
  const rcpt = await tx.wait();
  if (!rcpt || rcpt.status !== 1) throw new Error(`${fn} failed: ${tx.hash}`);
  return { hash: tx.hash as string, receipt: rcpt };
}
