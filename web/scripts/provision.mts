/**
 * Provision an institution in Privy from the command line (same code path as the admin API).
 *   npx tsx scripts/provision.ts <id> "<name>" <trader@> <compliance@> <pm@>
 */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const [, , id, name, trader, compliance, pm] = process.argv;
if (!pm) throw new Error("usage: provision.ts <id> <name> <trader@> <compliance@> <pm@>");
const { provisionInstitution } = await import("../src/lib/provision");
const inst = await provisionInstitution({
  id,
  name,
  members: [
    { email: trader, role: "trader" },
    { email: compliance, role: "compliance" },
    { email: pm, role: "pm" },
  ],
});
console.log(JSON.stringify(inst, null, 2));
