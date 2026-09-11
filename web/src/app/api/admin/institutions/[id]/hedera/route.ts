import { jsonError, HttpError, requireSession } from "@/lib/privy-server";
import { readOrg } from "@/lib/org";
import { fund, eligibility, allocate, proposeDeskStep, fundUsd, syncOnboarding, deskBalances, onboardingOf } from "@/lib/onboarding";

function requireOperator(userId: string) {
  const allowed = (process.env.PLATFORM_ADMIN_PRIVY_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(userId)) throw new HttpError(403, "not a platform administrator");
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireSession(req);
    requireOperator(s.userId);
    const { id } = await ctx.params;
    const events = new URL(req.url).searchParams.get("sync") ? await syncOnboarding(id) : [];
    const inst = readOrg().institutions.find((i) => i.id === id);
    if (!inst?.wallet) throw new HttpError(404, "institution / wallet not found");
    const balances = await deskBalances(inst.wallet.address);
    return Response.json({ hedera: onboardingOf(inst), balances, events });
  } catch (e) {
    return jsonError(e);
  }
}

/** Body: { action: 'fund'|'eligibility'|'revoke'|'allocate'|'usdAssociate'|'fundUsd'|'allowLoan'|'allowUsd', par?, usd?, hbar? } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const s = await requireSession(req);
    requireOperator(s.userId);
    const { id } = await ctx.params;
    const b = await req.json();
    switch (b.action) {
      case "fund":
        return Response.json(await fund(id, String(b.hbar ?? "25")));
      case "eligibility":
        return Response.json(await eligibility(id, true));
      case "revoke":
        return Response.json(await eligibility(id, false));
      case "allocate":
        return Response.json(await allocate(id, String(b.par)));
      case "usdAssociate":
      case "allowLoan":
      case "allowUsd":
        return Response.json({ intentId: await proposeDeskStep(id, b.action) });
      case "fundUsd":
        return Response.json(await fundUsd(id, String(b.usd ?? "0")));
      default:
        throw new HttpError(400, "unknown action");
    }
  } catch (e) {
    return jsonError(e);
  }
}
