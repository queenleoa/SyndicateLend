/**
 * Generate local ECDSA keys for the demo institutions (fallback / test desks until the Privy
 * quorum wallets exist). Appends DESK_* entries to the repo-root .env (gitignored) once.
 *   npx tsx src/gen-desks.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env");
const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (current.includes("DESK_SELLER_PRIVATE_KEY")) {
  console.log("desk keys already present in .env");
  process.exit(0);
}
const desks = [
  ["SELLER", "Meridian Credit Partners (seller desk)"],
  ["BUYER", "Halcyon Loan Fund IV (buyer desk)"],
  ["LENDER3", "Northgate Insurance (holder)"],
  ["OUTSIDER", "Unverified account (must be rejected)"],
];
let out = "\n# ---- Demo institution desks (local ECDSA keys; synthetic testnet identities) ----\n";
for (const [k, label] of desks) {
  const w = Wallet.createRandom();
  out += `# ${label}\nDESK_${k}_EVM_ADDRESS=${w.address}\nDESK_${k}_PRIVATE_KEY=${w.privateKey}\n`;
  console.log(`${k.padEnd(8)} ${w.address}  ${label}`);
}
fs.appendFileSync(envPath, out);
console.log(`appended to ${envPath}`);
