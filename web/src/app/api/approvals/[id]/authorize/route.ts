import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { authorizeIntent, submitIntentSignature } from "@/lib/approvals";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireSession(req);
    if (!findMember(readOrg(), s.userId)) throw new HttpError(403, "not a desk member");
    const { id } = await ctx.params;
    // Preferred: the approver signed the intent payload in the browser with their Privy user key.
    const body = await req.json().catch(() => ({}));
    if (typeof body.signature === "string" && typeof body.timestamp === "number") {
      const result = await submitIntentSignature(id, body.signature, body.timestamp);
      return Response.json({ result });
    }
    // Fallback: exchange the approver's session for a user key on the server and sign here.
    try {
      const result = await authorizeIntent(id, s.accessToken);
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
