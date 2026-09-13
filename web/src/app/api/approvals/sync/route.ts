import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { syncInstitutionApprovals } from "@/lib/sync-institution-approvals";
import { HostedDemoError } from "@/lib/demo/hosted-store";

export const maxDuration = 60;

/** Explicit retry for already-approved transactions if a hosted worker was busy. */
export async function POST(req: Request) {
  try {
    const session = await requireSession(req);
    const hit = findMember(readOrg(), session.userId);
    if (!hit) throw new HttpError(403, "Only an institution member can check its approved transactions.");
    return Response.json(await syncInstitutionApprovals(hit.institution.id));
  } catch (error) {
    return jsonError(error instanceof HostedDemoError ? new HttpError(error.status, error.message) : error);
  }
}
