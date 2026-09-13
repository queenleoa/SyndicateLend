import { after } from "next/server";
import { requireSession, jsonError } from "@/lib/privy-server";
import { findMember, readOrg, ROLE_LABEL } from "@/lib/org";
import { provisionForUser, onboardingSummary } from "@/lib/self-service";
import { marketTick } from "@/lib/automated-desk";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    let hit = findMember(readOrg(), s.userId);
    let created = false;
    if (!hit) {
      // First sign-in: this email becomes the trader of a new institution whose other two quorum
      // members are the +compliance and +pm aliases of the same inbox.
      const inst = await provisionForUser(s.userId);
      hit = { institution: inst, member: inst.members.find((m) => m.privyUserId === s.userId)! };
      created = true;
      after(() => marketTick(true));
    }
    const { institution, member } = hit;
    return Response.json({
      userId: s.userId,
      role: member.role,
      roleLabel: ROLE_LABEL[member.role],
      created,
      onboarding: onboardingSummary(institution),
      institution: { id: institution.id, name: institution.name, selfService: institution.selfService ?? false, wallet: institution.wallet ?? null, keyQuorumId: institution.keyQuorumId ?? null, policyId: institution.policyId ?? null, members: institution.members.map((m) => ({ email: m.email, role: m.role })) },
    });
  } catch (e) {
    return jsonError(e);
  }
}
