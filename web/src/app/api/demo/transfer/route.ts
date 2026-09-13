import { after } from "next/server";
import { jsonError, requireSession } from "@/lib/privy-server";
import { createTransferRequest, transferDemoStatus } from "@/lib/demo/transfer-request";
import { marketTick } from "@/lib/automated-desk";

export const maxDuration = 60;

/** Read-only status of the two automated demo institutions and the current demo assignment. */
export async function GET(req: Request) {
  try {
    await requireSession(req);
    after(() => marketTick());
    return Response.json(transferDemoStatus(), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

/** Any signed-in user can ask the two automated institutions to agree a synthetic transfer. */
export async function POST(req: Request) {
  try {
    const s = await requireSession(req);
    const trade = await createTransferRequest(s.userId);
    return Response.json({ trade, status: transferDemoStatus() });
  } catch (e) {
    return jsonError(e);
  }
}
