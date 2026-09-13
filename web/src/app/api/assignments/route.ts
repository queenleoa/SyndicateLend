import { after } from "next/server";
import { jsonError } from "@/lib/privy-server";
import { optionalDesk } from "@/lib/desk-auth";
import { readOrg } from "@/lib/org";
import { trades } from "@/lib/trades";
import { isPlatformAdmin } from "@/lib/agent";
import { marketTick } from "@/lib/automated-desk";
import { transferDemoStatus } from "@/lib/demo/transfer-request";

export const maxDuration = 60;

/** Registry view of every assignment: consent state, desk approvals, settlement. */
export async function GET(req: Request) {
  try {
    const d = await optionalDesk(req);
    after(() => marketTick());
    const org = readOrg();
    const names = Object.fromEntries(org.institutions.map((i) => [i.id, i.name]));
    const automated = org.institutions.filter((i) => i.automated).map((i) => i.id);
    const delayS = Number(process.env.AGENT_CONSENT_DELAY_S ?? "45");
    return Response.json({
      me: { userId: d.userId, isAgent: isPlatformAdmin(d.userId), institution: d.institution?.id ?? null },
      names,
      automated,
      autoConsentDelayS: delayS,
      demo: transferDemoStatus(),
      trades: trades.read().trades.sort((a, b) => b.createdAt - a.createdAt).map((t) => ({ ...t, autoConsentEnabled: !t.demo?.manualConsent })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
