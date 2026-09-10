
import fs from "node:fs";
import path from "node:path";

/** Hedera testnet venue addresses, read from the ops deployment record (single source of truth). */
export const HEDERA_TESTNET_CHAIN_ID = 296;

export interface Venue {
  chainId: number;
  settlementEngine: string;
  loanToken: string;
  mockUsd: string;
}

export function venue(): Venue {
  const file = path.resolve(process.cwd(), "../ops/deployments/testnet.json");
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    chainId: HEDERA_TESTNET_CHAIN_ID,
    settlementEngine: d.settlementEngine.address,
    loanToken: d.loanToken.evmAddress,
    mockUsd: d.mockUsd.evmAddress,
  };
}
