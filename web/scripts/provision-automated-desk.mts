/**
 * One-off: create the automated liquidity desk (quorum of two server-held keys) and onboard it on Hedera.
 * Prints the two private keys to append to .env as AUTOMATED_DESK_KEYS (and to the hosting provider's env).
 *   npx tsx scripts/provision-automated-desk.mts [id] ["Name"]
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
import { generateKeyPairSync } from "node:crypto";
const { hydrate, flush } = await import("../src/lib/store");
const { readOrg } = await import("../src/lib/org");
const { provisionAutomatedDesk } = await import("../src/lib/provision");
const { advanceOnboarding, onboardingReady } = await import("../src/lib/self-service");
const { authorizePendingAutomatedIntents } = await import("../src/lib/automated-desk");
await hydrate();
const id = process.argv[2] ?? "aldgate";
const name = process.argv[3] ?? "Aldgate Automated Liquidity";
let inst = readOrg().institutions.find((i) => i.id === id);
if (!inst) {
  if (!process.env.AUTOMATED_DESK_KEYS) {
    const pairs = [1, 2].map(() => {
      const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      return { priv: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), pub: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
    });
    process.env.AUTOMATED_DESK_KEYS = pairs.map((k) => k.priv).join(",");
    console.log(`\nAdd to .env (and to the hosting env):\nAUTOMATED_DESK_KEYS=${process.env.AUTOMATED_DESK_KEYS}\n`);
    inst = await provisionAutomatedDesk({ id, name, publicKeys: pairs.map((k) => k.pub) });
  } else {
    throw new Error("AUTOMATED_DESK_KEYS is set but no automated desk is recorded; unset it to generate a new desk");
  }
  console.log(`provisioned ${inst.name}: wallet ${inst.wallet!.address}`);
}
// Operator steps and self-signed desk steps until the desk holds par and cash.
for (let i = 0; i < 12 && !onboardingReady(readOrg().institutions.find((x) => x.id === id)!); i++) {
  const step = await advanceOnboarding(id);
  console.log(`step: ${step ?? "waiting"}`);
  const signed = await authorizePendingAutomatedIntents(readOrg().institutions.find((x) => x.id === id)!);
  if (signed.length) console.log(`signed: ${signed.join(", ")}`);
  await new Promise((r) => setTimeout(r, 4000));
}
console.log(onboardingReady(readOrg().institutions.find((x) => x.id === id)!) ? "automated desk ready" : "not ready yet; run again or let the market tick finish it");
await flush();
process.exit(0);
