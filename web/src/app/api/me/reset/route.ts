import { jsonError, HttpError, requireSession } from "@/lib/privy-server";
import { emailOfUser, resetAllowed, resetDesk, ResetRefused } from "@/lib/reset";

export const maxDuration = 60;

/** Drop the caller's institution so the next sign-in provisions a fresh one. Restricted to DESK_RESET_EMAILS. */
export async function POST(req: Request) {
  try {
    const s = await requireSession(req);
    const email = await emailOfUser(s.userId);
    if (!resetAllowed(email)) throw new HttpError(403, "Desk reset is limited to the configured test email group.");
    return Response.json(await resetDesk(s.userId));
  } catch (e) {
    if (e instanceof ResetRefused) return Response.json({ error: e.message }, { status: 403 });
    return jsonError(e);
  }
}
