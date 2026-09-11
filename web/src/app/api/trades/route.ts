import { jsonError } from "@/lib/privy-server";
import { requireDesk } from "@/lib/desk-auth";
import { syncTrades } from "@/lib/rfq";
import { trades } from "@/lib/trades";
import { readOrg } from "@/lib/org";

/** Trades with fresh intent / engine state. ?sync=1 reconciles with Privy and Hedera first. */
export async function GET(req: Request) {
  try {
    const d = await requireDesk(req);
    const url = new URL(req.url);
    const events = url.searchParams.get("sync") ? await syncTrades() : [];
    const names = Object.fromEntries(readOrg().institutions.map((i) => [i.id, i.name]));
    return Response.json({ me: { institution: d.institution.id, role: d.member.role }, names, events, trades: trades.read().trades.sort((a, b) => b.createdAt - a.createdAt) });
  } catch (e) {
    return jsonError(e);
  }
}
