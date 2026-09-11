/** List intents on an institution's desk wallet with authorisation progress and results. */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { readOrg } = await import("../src/lib/org");
const { listWalletIntents } = await import("../src/lib/approvals");
const inst = readOrg().institutions.find((i) => i.id === (process.argv[2] ?? "meridian"))!;
type IntentView = { intent_id: string; status: string; created_at: number; authorization_details: { threshold: number; members: { signed_at?: number; user_id?: string }[] }[]; action_result?: unknown };
for (const it of (await listWalletIntents(inst.wallet!.id)) as unknown as IntentView[]) {
  const q = it.authorization_details[0];
  const signed = q?.members.filter((m) => m.signed_at).map((m) => `${m.user_id}@${new Date(m.signed_at!).toISOString()}`);
  console.log(`${it.intent_id} ${it.status} created ${new Date(it.created_at).toISOString()} signed ${signed?.length}/${q?.threshold}`, signed);
  if (it.action_result) console.log("  action_result:", JSON.stringify(it.action_result).slice(0, 400));
}
