/**
 * Simulate a first sign-in for an email: create the Privy user if needed, provision its self-service
 * desk, and run market ticks until the operator side of onboarding is done. The person then signs the
 * three desk steps in the app as trader and as the +compliance alias.
 *   npx tsx scripts/self-service-test.mts someone@example.com
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { hydrate, flush } = await import("../src/lib/store");
const { privy } = await import("../src/lib/privy-server");
const { readOrg, findMember } = await import("../src/lib/org");
const { provisionForUser, onboardingSummary } = await import("../src/lib/self-service");
const { marketTick } = await import("../src/lib/automated-desk");
await hydrate();
const email = process.argv[2];
if (!email) throw new Error("usage: self-service-test.mts <email>");
const p = privy();
let user;
try { user = await p.users().getByEmailAddress({ address: email }); } catch { user = await p.users().create({ linked_accounts: [{ type: "email", address: email }] }); }
let hit = findMember(readOrg(), user.id);
if (!hit) {
  const inst = await provisionForUser(user.id);
  console.log(`provisioned ${inst.name} (${inst.id}); members: ${inst.members.map((m) => `${m.role}=${m.email}`).join(", ")}`);
  hit = findMember(readOrg(), user.id);
}
for (let i = 0; i < 6; i++) {
  const log = await marketTick(true);
  console.log(`tick ${i + 1}: ${log.join(" | ") || "idle"}`);
  const s = onboardingSummary(readOrg().institutions.find((x) => x.id === hit!.institution.id)!);
  const active = s.steps.find((x) => x.state === "active");
  if (!active || active.needsDesk) break;
  await new Promise((r) => setTimeout(r, 3000));
}
const s = onboardingSummary(readOrg().institutions.find((x) => x.id === hit!.institution.id)!);
console.log(s.steps.map((x) => `${x.state === "done" ? "✓" : x.state === "active" ? "•" : " "} ${x.label}${x.detail ? ` (${x.detail})` : ""}`).join("\n"));
await flush();
process.exit(0);
