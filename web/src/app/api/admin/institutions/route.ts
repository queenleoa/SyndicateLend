import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { listInstitutions, provisionInstitution } from "@/lib/provision";
import { isPlatformAdmin } from "@/lib/agent";

/** Platform administration: only the operator allow-list may provision institutions. */
function requireOperator(userId: string) {
  if (!isPlatformAdmin(userId)) throw new HttpError(403, "not a platform administrator");
}

export async function GET(req: Request) {
  try {
    const s = await requireSession(req);
    requireOperator(s.userId);
    return Response.json({ institutions: listInstitutions() });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(req: Request) {
  try {
    const s = await requireSession(req);
    requireOperator(s.userId);
    const body = await req.json();
    const inst = await provisionInstitution(body);
    return Response.json({ institution: inst });
  } catch (e) {
    return jsonError(e);
  }
}
