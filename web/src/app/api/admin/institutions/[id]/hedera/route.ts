import { jsonError, HttpError, requireSession } from "@/lib/privy-server";
import { readOrg } from "@/lib/org";
import { isPlatformAdmin } from "@/lib/agent";
import { fund, eligibility, allocate, proposeDeskStep, fundUsd, syncOnboarding, deskBalances, onboardingOf } from "@/lib/onboarding";
import { HostedDemoError, withHostedLeaseWait } from "@/lib/demo/hosted-store";

function requireOperator(userId: string) {
  if (!isPlatformAdmin(userId)) throw new HttpError(403, "not a platform administrator");
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
    // Operator-signed steps share the agent bank's lock with the market tick and the issuance wizard.
    const result = await withHostedLeaseWait("operator-transactions", 30_000, async () => {
      switch (b.action) {
        case "fund":
          return fund(id, String(b.hbar ?? "25"));
        case "eligibility":
          return eligibility(id, true);
        case "revoke":
          return eligibility(id, false);
        case "allocate":
          return allocate(id, String(b.par));
        case "usdAssociate":
        case "allowLoan":
        case "allowUsd":
          return { intentId: await proposeDeskStep(id, b.action) };
        case "fundUsd":
          return fundUsd(id, String(b.usd ?? "0"));
        default:
          throw new HttpError(400, "unknown action");
      }
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof HostedDemoError) return Response.json({ error: e.message }, { status: e.status });
    return jsonError(e);
  }
}
