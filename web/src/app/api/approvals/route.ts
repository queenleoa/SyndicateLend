import { after } from "next/server";
import { requireSession, jsonError, HttpError, privy } from "@/lib/privy-server";
import { marketTick } from "@/lib/automated-desk";
import { findMember, readOrg } from "@/lib/org";
import { listWalletIntents, proposeSignTransaction } from "@/lib/approvals";
import { venue } from "@/lib/venue";
import { onboardingOf } from "@/lib/onboarding";
import { onboardingSummary } from "@/lib/self-service";
import { setupIntentMap, supersededSetupIntentIds } from "@/lib/approval-notifications";

export const maxDuration = 60;

function requireDesk(userId: string) {
  const hit = findMember(readOrg(), userId);
  if (!hit) throw new HttpError(403, "your user is not attached to an institution");
  if (!hit.institution.wallet) throw new HttpError(409, "institution has no desk wallet yet");
  return hit;
}

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    after(() => marketTick());
    if (!findMember(readOrg(), s.userId)) return Response.json({ observer: true, institution: null, me: { userId: s.userId, role: "observer" }, intents: [] });
    const { institution, member } = requireDesk(s.userId);
    const [intents, quorum] = await Promise.all([
      listWalletIntents(institution.wallet!.id),
      institution.keyQuorumId ? privy().keyQuorums().get(institution.keyQuorumId).catch(() => null) : null,
    ]);
    const v = venue();
    const superseded = supersededSetupIntentIds(onboardingOf(institution));
    return Response.json({
      institution: { id: institution.id, name: institution.name, cosigner: institution.cosigner ?? null, wallet: institution.wallet, keyQuorumId: institution.keyQuorumId ?? null, policyId: institution.policyId ?? null, quorum: quorum ? { threshold: quorum.authorization_threshold, userIds: quorum.user_ids ?? [], keys: quorum.authorization_keys?.length ?? 0 } : null, reserveSigner: institution.reserveSigner?.publicKey ?? null, members: institution.members.map((m) => ({ email: m.email, role: m.role, privyUserId: m.privyUserId })) },
      me: { userId: s.userId, role: member.role }, intents: intents.map((intent) => ({ ...intent, superseded: superseded.has(intent.intent_id) })),
      onboarding: onboardingSummary(institution), setupIntents: setupIntentMap(onboardingOf(institution)),
      venue: { engine: v.settlementEngine, loan: v.loanToken, usd: v.mockUsd },
    }, { headers: { "Cache-Control": "private, no-store" } });
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
