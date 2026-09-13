import { jsonError, HttpError } from "@/lib/privy-server";
import { requireDesk } from "@/lib/desk-auth";
import { findTrade } from "@/lib/trades";
import { getTrade } from "@/lib/engine";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireDesk(req);
    const { id } = await ctx.params;
    const t = findTrade(id);
    if (!t) throw new HttpError(404, "trade not found");
    const onchain = id.startsWith("pending-") ? null : await getTrade(id).catch(() => null);
    return Response.json({ trade: t, onchain });
  } catch (e) {
    return jsonError(e);
  }
}
