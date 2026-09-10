import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { listInstitutions, provisionInstitution } from "@/lib/provision";

/** Platform administration: only the operator allow-list may provision institutions. */
function requireOperator(userId: string) {
  const allowed = (process.env.PLATFORM_ADMIN_PRIVY_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(userId)) throw new HttpError(403, "not a platform administrator");
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
