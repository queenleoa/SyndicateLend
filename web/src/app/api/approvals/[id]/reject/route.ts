import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { rejectIntent } from "@/lib/approvals";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireSession(req);
    const hit = findMember(readOrg(), s.userId);
    if (!hit) throw new HttpError(403, "not a desk member");
    if (hit.member.role !== "compliance" && hit.member.role !== "pm") throw new HttpError(403, "only compliance or the portfolio manager can reject");
    const { id } = await ctx.params;
    return Response.json({ intent: await rejectIntent(id) });
  } catch (e) {
    return jsonError(e);
  }
}
