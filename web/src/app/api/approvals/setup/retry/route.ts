import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { HostedDemoError } from "@/lib/demo/hosted-store";
import { parseSetupRetry } from "@/lib/setup-recovery";
import { retrySetupApproval } from "@/lib/retry-setup";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    const member = findMember(readOrg(), session.userId);
    if (!member) throw new HttpError(403, "Only an institution member can request a replacement setup approval.");
    let input;
    try { input = parseSetupRetry(await req.json()); } catch { throw new HttpError(400, "Select the exact failed setup approval; custom transaction parameters are not allowed."); }
    return Response.json(await retrySetupApproval(member.institution.id, input.step, input.intentId));
  } catch (error) { return jsonError(error instanceof HostedDemoError ? new HttpError(error.status, error.message) : error); }
}
