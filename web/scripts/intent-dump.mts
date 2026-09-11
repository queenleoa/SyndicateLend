import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
const { readOrg } = await import("../src/lib/org");
const { listWalletIntents } = await import("../src/lib/approvals");
const inst = readOrg().institutions.find((i) => i.id === "meridian")!;
const items = (await listWalletIntents(inst.wallet!.id)) as any[];
for (const it of items) console.log(it.intent_id, it.status, JSON.stringify(it.action_result ?? null).slice(0, 900));
