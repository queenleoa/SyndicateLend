import { after } from "next/server";
import { setTimeout as delay } from "node:timers/promises";
import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { authorizeIntent, submitIntentSignature, getIntent } from "@/lib/approvals";
import { syncInstitutionApprovals } from "@/lib/sync-institution-approvals";
import { supersededSetupIntentIds } from "@/lib/approval-notifications";
import { onboardingOf } from "@/lib/onboarding";
import { cosignIfHumanSigned } from "@/lib/automated-desk";

export const maxDuration = 60;

/** After an approval, give Privy a moment to execute, then broadcast anything executed to Hedera. */
function scheduleSync(institutionId: string, intentId: string) {
  after(async () => {
    await delay(4000);
    try { await syncInstitutionApprovals(institutionId, intentId); }
    catch { console.warn("[approvals] Execution sync deferred. The institution can retry from its approval inbox."); }
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireSession(req);
    const hit = findMember(readOrg(), s.userId);
    if (!hit) throw new HttpError(403, "not a desk member");
    const { id } = await ctx.params;
    if (supersededSetupIntentIds(onboardingOf(hit.institution)).has(id)) throw new HttpError(409, "This setup approval has been superseded. Refresh and review the current approval.");
    const intent = await getIntent(id);
    if (!hit.institution.wallet || intent.resource_id !== hit.institution.wallet.id) throw new HttpError(403, "This approval does not belong to your institution’s wallet.");
    // Preferred: the approver signed the intent payload in the browser with their Privy user key.
    const body = await req.json().catch(() => ({}));
    if (typeof body.signature === "string" && typeof body.timestamp === "number") {
      let result = await submitIntentSignature(id, body.signature, body.timestamp);
      // Judge desks: the venue's automated compliance co-signer completes the quorum straight away.
      let cosigned: string | null = null;
      if (hit.institution.cosigner === "automated") {
        try { cosigned = await cosignIfHumanSigned(id); result = { ...(result as object), status: cosigned } as typeof result; } catch (e) { cosigned = `co-signature deferred: ${(e as Error).message.slice(0, 120)}`; }
      }
      scheduleSync(hit.institution.id, id);
      return Response.json({ result, cosigned });
    }
    // Fallback: exchange the approver's session for a user key on the server and sign here.
    try {
      const result = await authorizeIntent(id, s.accessToken);
      scheduleSync(hit.institution.id, id);
      return Response.json({ result });
    } catch (e) {
      // Surface non-secret token claims so a rejected exchange can be diagnosed.
      const [, payload = ""] = s.accessToken.split(".");
      let claims: Record<string, unknown> = {};
      try {
        claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {}
      const { iss, aud, exp, iat, sid } = claims as Record<string, unknown>;
      throw new HttpError(502, `${(e as Error).message} | token claims: ${JSON.stringify({ iss, aud, exp, iat, sid, now: Math.floor(Date.now() / 1000) })}`);
    }
  } catch (e) {
    return jsonError(e);
  }
}
