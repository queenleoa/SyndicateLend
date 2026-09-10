import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the repo-root .env regardless of cwd.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

export const NETWORK = process.env.HEDERA_NETWORK ?? "testnet";
export const RPC_URL = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
export const MIRROR_URL = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
export const HASHSCAN = `https://hashscan.io/${NETWORK}`;
