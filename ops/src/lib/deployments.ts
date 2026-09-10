import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NETWORK } from "./env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(here, `../../deployments/${NETWORK}.json`);

export interface Institution {
  name: string;
  role: string;
  evmAddress: string;
  accountId?: string;
  usdKyc?: boolean;
  loanEligible?: boolean;
  notes?: string;
}

export interface Deployments {
  network: string;
  operator?: { accountId: string; evmAddress: string };
  mockUsd?: { tokenId: string; evmAddress: string; decimals: number; symbol: string; createTx: string };
  topics?: { rfq?: string; notices?: string };
  loanToken?: Record<string, unknown>;
  settlementEngine?: { address: string; deployTx?: string };
  interestDistributor?: { address: string; deployTx?: string };
  institutions?: Institution[];
  [k: string]: unknown;
}

export function readDeployments(): Deployments {
  if (!fs.existsSync(file)) return { network: NETWORK };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeDeployments(mutate: (d: Deployments) => void): Deployments {
  const d = readDeployments();
  mutate(d);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
  return d;
}
