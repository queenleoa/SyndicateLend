/**
 * Create an automated desk (quorum of the two server-held keys in AUTOMATED_DESK_KEYS) and onboard it on
 * Hedera. The first run without AUTOMATED_DESK_KEYS generates the keys and prints them once.
 *   npx tsx scripts/provision-automated-desk.mts [id] ["Name"] [--demo-counterparty]
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
const { hydrate, flush } = await import("../src/lib/store");
const { readOrg, writeOrg } = await import("../src/lib/org");
const { provisionAutomatedDesk } = await import("../src/lib/provision");
const { advanceOnboarding, onboardingReady } = await import("../src/lib/self-service");
const { authorizePendingAutomatedIntents } = await import("../src/lib/automated-desk");
await hydrate();
const positional = process.argv.slice(2).filter((v) => !v.startsWith("--"));
const id = positional[0] ?? "aldgate";
const name = positional[1] ?? "Aldgate Automated Liquidity";
const demoCounterparty = process.argv.includes("--demo-counterparty");
let inst = readOrg().institutions.find((i) => i.id === id);
if (!inst) {
  let publicKeys: string[];
  if (!process.env.AUTOMATED_DESK_KEYS) {
    const pairs = [1, 2].map(() => {
      const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      return { priv: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), pub: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
    });
    process.env.AUTOMATED_DESK_KEYS = pairs.map((k) => k.priv).join(",");
    console.log(`\nAdd to .env (and to the hosting env):\nAUTOMATED_DESK_KEYS=${process.env.AUTOMATED_DESK_KEYS}\n`);
    publicKeys = pairs.map((k) => k.pub);
  } else {
    // Reuse the existing automation keys: the new desk's quorum is the same two server-held keys.
    publicKeys = process.env.AUTOMATED_DESK_KEYS.split(",").map((v) => v.trim()).filter(Boolean).map((priv) => createPublicKey(createPrivateKey({ key: Buffer.from(priv, "base64"), type: "pkcs8", format: "der" })).export({ type: "spki", format: "der" }).toString("base64"));
    if (publicKeys.length < 2) throw new Error("AUTOMATED_DESK_KEYS must hold two keys");
  }
  inst = await provisionAutomatedDesk({ id, name, publicKeys });
  if (demoCounterparty) writeOrg((o) => { o.institutions.find((i) => i.id === id)!.demoCounterparty = true; });
  console.log(`provisioned ${inst.name}: wallet ${inst.wallet!.address}`);
}
// Operator steps and self-signed desk steps until the desk holds par and cash.
for (let i = 0; i < 40 && !onboardingReady(readOrg().institutions.find((x) => x.id === id)!); i++) {
  const step = await advanceOnboarding(id);
  console.log(`step: ${step ?? "waiting"}`);
  const signed = await authorizePendingAutomatedIntents(readOrg().institutions.find((x) => x.id === id)!);
  if (signed.length) console.log(`signed: ${signed.join(", ")}`);
  await new Promise((r) => setTimeout(r, 4000));
}
console.log(onboardingReady(readOrg().institutions.find((x) => x.id === id)!) ? "automated desk ready" : "not ready yet; run again or let the market tick finish it");
await flush();
process.exit(0);
