import { after } from "next/server";
import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { marketTick } from "@/lib/automated-desk";
import { findMember, readOrg } from "@/lib/org";
import { listWalletIntents } from "@/lib/approvals";
import { onboardingOf } from "@/lib/onboarding";
import { notificationSummary, setupIntentMap, supersededSetupIntentIds, type ApprovalIntent } from "@/lib/approval-notifications";

/** Read-only for the caller; the market tick it schedules runs the agent bank's own automation. */
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    after(() => marketTick());
    const hit = findMember(readOrg(), session.userId);
    if (!hit) return Response.json(notificationSummary([], session.userId, {}), { headers: { "Cache-Control": "private, no-store" } });
    if (!hit.institution.wallet) throw new HttpError(409, "Institutional wallet is not yet available; approval notifications cannot be checked.");
    const intents = await listWalletIntents(hit.institution.wallet.id);
    const superseded = supersededSetupIntentIds(onboardingOf(hit.institution));
    return Response.json(notificationSummary(intents.filter((intent) => !superseded.has(intent.intent_id)) as unknown as ApprovalIntent[], session.userId, setupIntentMap(onboardingOf(hit.institution))), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
