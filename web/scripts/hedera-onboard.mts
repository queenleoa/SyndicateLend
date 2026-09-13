/**
 * Operator-side Hedera onboarding of a Privy desk wallet.
 *   npx tsx scripts/hedera-onboard.mts <institution> fund [hbar]
 *   npx tsx scripts/hedera-onboard.mts <institution> eligibility
 *   npx tsx scripts/hedera-onboard.mts <institution> allocate <par>
 *   npx tsx scripts/hedera-onboard.mts <institution> propose usdAssociate|allowLoan|allowUsd   (desk quorum then approves in the app)
 *   npx tsx scripts/hedera-onboard.mts <institution> sync          (broadcast executed desk steps)
 *   npx tsx scripts/hedera-onboard.mts <institution> fundUsd <usd>  (after usdAssociate is on-chain)
 *   npx tsx scripts/hedera-onboard.mts <institution> status
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { hydrate, flush } = await import("../src/lib/store");
await hydrate();
const ob = await import("../src/lib/onboarding");
const { readOrg } = await import("../src/lib/org");
const [, , id, action, arg] = process.argv;
if (!id || !action) throw new Error("usage: <institution> <action> [arg]");
const out =
  action === "fund" ? await ob.fund(id, arg ?? "25")
  : action === "eligibility" ? await ob.eligibility(id, true)
  : action === "revoke" ? await ob.eligibility(id, false)
  : action === "allocate" ? await ob.allocate(id, arg!)
  : action === "propose" ? { intentId: await ob.proposeDeskStep(id, arg as "usdAssociate" | "allowLoan" | "allowUsd") }
  : action === "sync" ? await ob.syncOnboarding(id)
  : action === "fundUsd" ? await ob.fundUsd(id, arg ?? "0")
  : action === "status" ? { hedera: ob.onboardingOf(readOrg().institutions.find((i) => i.id === id)!), balances: await ob.deskBalances(readOrg().institutions.find((i) => i.id === id)!.wallet!.address) }
  : (() => { throw new Error("unknown action"); })();
console.log(JSON.stringify(out, null, 2));
await flush();
