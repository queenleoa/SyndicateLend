import { requireSession, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { beginIssuance, issuanceStatus } from "@/lib/issuance";
import { HostedDemoError } from "@/lib/demo/hosted-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const session = await requireSession(req);
    return Response.json(await issuanceStatus(session.userId, findMember(readOrg(), session.userId)?.institution.id ?? null), { headers: { "cache-control": "no-store" } });
  }
  catch (error) { return errorResponse(error); }
}

export async function POST(req: Request) {
  try {
    if (!req.headers.get("authorization")?.startsWith("Bearer ")) throw new HttpError(401, "Sign in before authorising an issuance.");
    const session = await requireSession(req);
    if (Number(req.headers.get("content-length") ?? 0) > 12_000) throw new HttpError(413, "Issuance request is too large.");
    const text = await req.text();
    if (text.length > 12_000) throw new HttpError(413, "Issuance request is too large.");
    let body;
    try { body = JSON.parse(text) as { terms?: unknown; confirmed?: boolean }; } catch { throw new HttpError(400, "Invalid issuance request."); }
    if (!body || body.confirmed !== true) throw new HttpError(400, "Review and confirm the testnet issuance before continuing.");
    return Response.json({ record: await beginIssuance(session.userId, body.terms) });
  } catch (error) { return errorResponse(error); }
}

function errorResponse(error: unknown) {
  if (error instanceof HttpError || error instanceof HostedDemoError) return Response.json({ error: error.message }, { status: error.status });
  // Never return provider errors, signed bytes, credentials or Redis details to a public judge session.
  return Response.json({ error: "Issuance could not be processed. Refresh its saved status before trying again." }, { status: 503 });
}
