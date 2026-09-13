import { jsonError, HttpError, requireSession } from "@/lib/privy-server";
import { readOrg, writeOrg } from "@/lib/org";
import { isPlatformAdmin } from "@/lib/agent";

/**
 * Remove an institution record from the directory (platform administrators only). Nothing in Privy or on
 * Hedera is deleted: the wallet, quorum, policy and balances remain; only the app stops listing the desk.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireSession(req);
    if (!isPlatformAdmin(s.userId)) throw new HttpError(403, "not a platform administrator");
    const { id } = await ctx.params;
    const inst = readOrg().institutions.find((i) => i.id === id);
    if (!inst) throw new HttpError(404, "institution not found");
    if (inst.members.some((m) => m.privyUserId === s.userId)) throw new HttpError(409, "Use Reset desk for your own institution.");
    writeOrg((o) => { o.institutions = o.institutions.filter((i) => i.id !== id); });
    return Response.json({ removed: id });
  } catch (e) {
    return jsonError(e);
  }
}
