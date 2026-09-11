import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { listWalletIntents, proposeSignTransaction } from "@/lib/approvals";
import { venue } from "@/lib/venue";

function requireDesk(userId: string) {
  const hit = findMember(readOrg(), userId);
  if (!hit) throw new HttpError(403, "your user is not attached to an institution");
  if (!hit.institution.wallet) throw new HttpError(409, "institution has no desk wallet yet");
  return hit;
}

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    const { institution, member } = requireDesk(s.userId);
    const intents = await listWalletIntents(institution.wallet!.id);
    return Response.json({ institution: { id: institution.id, name: institution.name, wallet: institution.wallet, members: institution.members.map((m) => ({ email: m.email, role: m.role, privyUserId: m.privyUserId })) }, me: { userId: s.userId, role: member.role }, intents });
  } catch (e) {
    return jsonError(e);
  }
}

/** Propose a desk action. Body: { to, data, summary } (to must be a venue contract). */
export async function POST(req: Request) {
  try {
    const s = await requireSession(req);
    const { institution, member } = requireDesk(s.userId);
    if (member.role !== "trader" && member.role !== "pm") throw new HttpError(403, "only traders or portfolio managers propose desk actions");
    const body = await req.json();
    const v = venue();
    const allowed = [v.settlementEngine, v.loanToken, v.mockUsd].map((a) => a.toLowerCase());
    if (!allowed.includes(String(body.to).toLowerCase())) throw new HttpError(400, "target is not a settlement venue contract");
    const intent = await proposeSignTransaction({ walletId: institution.wallet!.id, walletAddress: institution.wallet!.address, to: body.to, data: body.data, summary: body.summary });
    return Response.json({ intent });
  } catch (e) {
    return jsonError(e);
  }
}
