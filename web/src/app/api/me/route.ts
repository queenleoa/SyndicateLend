import { after } from "next/server";
import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg, ROLE_LABEL } from "@/lib/org";
import { provisionForUser, onboardingSummary } from "@/lib/self-service";
import { marketTick, operatorReserved } from "@/lib/automated-desk";
import { emailOfUser, resetAllowed } from "@/lib/reset";
import { redisBacked } from "@/lib/store";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    let hit = findMember(readOrg(), s.userId);
    let created = false;
    if (!hit) {
      // Never provision on a hosted instance without a shared store: each serverless instance would create its
      // own institution (and Privy wallet) and the others would answer "not a desk member".
      if (process.env.VERCEL && !redisBacked) throw new HttpError(503, "The hosted demo store is not configured: attach Upstash Redis to this Vercel environment (UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN) and redeploy.");
      // First sign-in: this email becomes the trader of a new institution whose other two quorum
      // members are the +compliance and +pm aliases of the same inbox.
      const inst = await provisionForUser(s.userId);
      hit = { institution: inst, member: inst.members.find((m) => m.privyUserId === s.userId)! };
      created = true;
    }
    // Any page load drives the market: onboarding steps, automated signatures, settlement sync.
    after(() => marketTick(created));
    const { institution, member } = hit;
    const canReset = Boolean(institution.selfService) && Boolean(process.env.DESK_RESET_EMAILS) && resetAllowed(await emailOfUser(s.userId));
    return Response.json({
      userId: s.userId,
      role: member.role,
      roleLabel: ROLE_LABEL[member.role],
      created,
      canReset,
      // Hosted deployments must be Redis-backed: without it every serverless instance keeps its own store,
      // so one instance provisions the institution and another answers "not a desk member".
      durableStore: redisBacked,
      operatorAutomationPaused: await operatorReserved(),
      onboarding: onboardingSummary(institution),
      institution: { id: institution.id, name: institution.name, selfService: institution.selfService ?? false, wallet: institution.wallet ?? null, keyQuorumId: institution.keyQuorumId ?? null, policyId: institution.policyId ?? null, members: institution.members.map((m) => ({ email: m.email, role: m.role })) },
    });
  } catch (e) {
    return jsonError(e);
  }
}
