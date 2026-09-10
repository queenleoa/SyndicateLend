import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { authorizeIntent } from "@/lib/approvals";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireSession(req);
    if (!findMember(readOrg(), s.userId)) throw new HttpError(403, "not a desk member");
    const { id } = await ctx.params;
    // The approver's own session token is what authorises: the server never holds a desk key.
    const result = await authorizeIntent(id, s.accessToken);
    return Response.json({ result });
  } catch (e) {
    return jsonError(e);
  }
}
