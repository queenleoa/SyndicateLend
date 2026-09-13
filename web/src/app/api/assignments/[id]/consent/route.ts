import { jsonError, HttpError } from "@/lib/privy-server";
import { optionalDesk } from "@/lib/desk-auth";
import { grantConsent } from "@/lib/rfq";
import { isPlatformAdmin } from "@/lib/agent";
import { automatedDesk, authorizeWithAppKeys } from "@/lib/automated-desk";

export const maxDuration = 60;

/** The arranger consents to an assignment: instruction on-chain, desks asked to approve. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const d = await optionalDesk(req);
    if (!isPlatformAdmin(d.userId)) throw new HttpError(403, "only the arranger (platform administrator) consents to assignments");
    const { id } = await ctx.params;
    const t = await grantConsent(id, d.userId, false);
    const bot = automatedDesk();
    if (bot && (t.seller.institution === bot.id || t.buyer.institution === bot.id)) {
      const mine = t.seller.institution === bot.id ? t.approvals.seller : t.approvals.buyer;
      await authorizeWithAppKeys(mine.intentId).catch(() => {});
    }
    return Response.json({ trade: t });
  } catch (e) {
    return jsonError(e);
  }
}
