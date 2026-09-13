import { after } from "next/server";
import { jsonError } from "@/lib/privy-server";
import { optionalDesk } from "@/lib/desk-auth";
import { readOrg } from "@/lib/org";
import { trades } from "@/lib/trades";
import { isPlatformAdmin } from "@/lib/agent";
import { marketTick } from "@/lib/automated-desk";

export const maxDuration = 60;

/** Registry view of every assignment: consent state, desk approvals, settlement. */
export async function GET(req: Request) {
  try {
    const d = await optionalDesk(req);
    after(() => marketTick());
    const names = Object.fromEntries(readOrg().institutions.map((i) => [i.id, i.name]));
    const delayS = Number(process.env.AGENT_CONSENT_DELAY_S ?? "45");
    return Response.json({
      me: { userId: d.userId, isAgent: isPlatformAdmin(d.userId), institution: d.institution?.id ?? null },
      names,
      autoConsentDelayS: delayS,
      trades: trades.read().trades.sort((a, b) => b.createdAt - a.createdAt),
    });
  } catch (e) {
    return jsonError(e);
  }
}
