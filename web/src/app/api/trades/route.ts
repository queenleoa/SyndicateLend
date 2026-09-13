import { after } from "next/server";
import { jsonError } from "@/lib/privy-server";
import { marketTick } from "@/lib/automated-desk";
import { optionalDesk } from "@/lib/desk-auth";
import { syncTrades } from "@/lib/rfq";
import { trades } from "@/lib/trades";
import { readOrg } from "@/lib/org";

/** Trades with fresh intent / engine state. ?sync=1 reconciles with Privy and Hedera first. */
export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const d = await optionalDesk(req);
    after(() => marketTick());
    const url = new URL(req.url);
    // Observers read the current state; only members trigger a reconciliation with Privy and Hedera.
    const events = url.searchParams.get("sync") && d.member ? await syncTrades() : [];
    const names = Object.fromEntries(readOrg().institutions.map((i) => [i.id, i.name]));
    return Response.json({ me: { institution: d.institution?.id ?? null, role: d.member?.role ?? "observer" }, names, events, trades: trades.read().trades.sort((a, b) => b.createdAt - a.createdAt) });
  } catch (e) {
    return jsonError(e);
  }
}
