import { jsonError } from "@/lib/privy-server";
import { requireDesk } from "@/lib/desk-auth";
import { deskBalances, onboardingOf } from "@/lib/onboarding";
import { trades } from "@/lib/trades";
import { readOrg } from "@/lib/org";

export async function GET(req: Request) {
  try {
    const d = await requireDesk(req);
    const w = d.institution.wallet;
    const balances = w ? await deskBalances(w.address) : null;
    const mine = trades.read().trades.filter((t) => t.seller.institution === d.institution.id || t.buyer.institution === d.institution.id);
    const names = Object.fromEntries(readOrg().institutions.map((i) => [i.id, i.name]));
    return Response.json({ institution: { id: d.institution.id, name: d.institution.name, wallet: w ?? null, hedera: onboardingOf(d.institution) }, balances, trades: mine.sort((a, b) => b.createdAt - a.createdAt), names });
  } catch (e) {
    return jsonError(e);
  }
}
