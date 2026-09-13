import { requireSession, HttpError } from "@/lib/privy-server";
import { advanceIssuance } from "@/lib/issuance";
import { HostedDemoError } from "@/lib/demo/hosted-store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!req.headers.get("authorization")?.startsWith("Bearer ")) throw new HttpError(401, "Sign in to continue the issuance.");
    const session = await requireSession(req);
    const { id } = await ctx.params;
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(400, "Invalid issuance identifier.");
    return Response.json({ record: await advanceIssuance(session.userId, id) });
  } catch (error) {
    if (error instanceof HttpError || error instanceof HostedDemoError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "The chain step could not be confirmed. Refresh to recover its saved transaction; no replacement token was requested." }, { status: 503 });
  }
}
