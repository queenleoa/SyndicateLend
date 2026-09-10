import { requireSession, jsonError } from "@/lib/privy-server";
import { findMember, readOrg, ROLE_LABEL } from "@/lib/org";

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    const hit = findMember(readOrg(), s.userId);
    if (!hit) return Response.json({ userId: s.userId, institution: null, role: null });
    const { institution, member } = hit;
    return Response.json({
      userId: s.userId,
      role: member.role,
      roleLabel: ROLE_LABEL[member.role],
      institution: { id: institution.id, name: institution.name, wallet: institution.wallet ?? null, keyQuorumId: institution.keyQuorumId ?? null, policyId: institution.policyId ?? null, members: institution.members.map((m) => ({ email: m.email, role: m.role })) },
    });
  } catch (e) {
    return jsonError(e);
  }
}
