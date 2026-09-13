import { jsonError, HttpError } from "@/lib/privy-server";
import { optionalDesk } from "@/lib/desk-auth";
import { grantConsent, syncTrades } from "@/lib/rfq";
import { trades } from "@/lib/trades";
import { isPlatformAdmin } from "@/lib/agent";
import { authorizeAutomatedSides } from "@/lib/automated-desk";
import { HostedDemoError, withHostedLeaseWait } from "@/lib/demo/hosted-store";

export const maxDuration = 60;

/**
 * The agent bank consents to an assignment: the instruction goes on-chain and both desks are asked to
 * approve. Automated desks sign immediately, so a demo transfer between two automated institutions moves
 * straight to the Hedera schedule. Platform administrators consent to any assignment; any signed-in judge
 * may consent to the synthetic transfer-request demo, which only ever involves the automated institutions.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const d = await optionalDesk(req);
    const { id } = await ctx.params;
    const target = trades.read().trades.find((x) => x.tradeId === id || `pending-${x.quoteId}` === id);
    if (!target) throw new HttpError(404, "assignment not found");
    if (!isPlatformAdmin(d.userId) && target.demo?.kind !== "transfer-demo") throw new HttpError(403, "only the agent bank (platform administrator) consents to assignments");
    // The settlement instruction is signed by the agent bank's account: hold its lock so the market tick
    // cannot send a competing transaction with the same nonce.
    const { trade, events } = await withHostedLeaseWait("operator-transactions", 30_000, async () => {
      const t = await grantConsent(id, d.userId, false);
      const log = await authorizeAutomatedSides(t.tradeId).catch((e: Error) => [e.message]);
      try { log.push(...(await syncTrades((x) => x.tradeId === t.tradeId))); } catch (e) { log.push((e as Error).message); }
      return { trade: trades.read().trades.find((x) => x.tradeId === t.tradeId) ?? t, events: log };
    });
    return Response.json({ trade, events });
  } catch (e) {
    if (e instanceof HostedDemoError) return Response.json({ error: e.message }, { status: e.status });
    return jsonError(e);
  }
}
