import { formatRequestForAuthorizationSignature, type WalletApiRequestSignatureInput } from "@privy-io/node";
import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { getIntent } from "@/lib/approvals";
import { onboardingOf } from "@/lib/onboarding";
import { supersededSetupIntentIds } from "@/lib/approval-notifications";

/**
 * Canonical bytes an approver signs in the browser with their Privy user key
 * (useAuthorizationSignature). The signed object is the intent's request plus a fresh
 * `timestamp` and the `intent_id` (replay binding); the same timestamp is posted with the
 * signature. Variants differ only in whether the request-expiry header is echoed.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireSession(req);
    const hit = findMember(readOrg(), s.userId);
    if (!hit?.institution.wallet) throw new HttpError(403, "not a desk member");
    const { id } = await ctx.params;
    if (supersededSetupIntentIds(onboardingOf(hit.institution)).has(id)) throw new HttpError(409, "This setup approval has been superseded. Refresh and review the current approval.");
    const intent = (await getIntent(id)) as { intent_id: string; resource_id?: string; request_details: { method: string; url: string; body: unknown }; expires_at: number; status: string };
    if (intent.resource_id !== hit.institution.wallet.id) throw new HttpError(403, "This approval does not belong to your institution wallet.");
    const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
    const rd = intent.request_details;
    const timestamp = Date.now();
    const headerVariants = [{ "privy-app-id": appId }, { "privy-app-id": appId, "privy-request-expiry": String(intent.expires_at) }];
    const payloads = headerVariants.map((headers) => {
      const input = { version: 1, method: rd.method, url: rd.url, body: rd.body, timestamp, intent_id: intent.intent_id, headers } as unknown as WalletApiRequestSignatureInput;
      return Buffer.from(formatRequestForAuthorizationSignature(input)).toString("base64");
    });
    return Response.json({ status: intent.status, timestamp, payloads });
  } catch (e) {
    return jsonError(e);
  }
}
