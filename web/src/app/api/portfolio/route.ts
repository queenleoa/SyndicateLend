import { jsonError } from "@/lib/privy-server";
import { optionalDesk } from "@/lib/desk-auth";
import { deskBalances, onboardingOf } from "@/lib/onboarding";
import { trades } from "@/lib/trades";
import { readOrg } from "@/lib/org";
import { assetBalances, listAssets, readDeployment } from "@/lib/assets";
import { holderPayoutLink, readDistribution, readPayout } from "@/lib/register-interest";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const d = await optionalDesk(req);
    const inst = d.institution;
    if (!inst) return Response.json({ observer: true, institution: null, balances: null, trades: [], names: {}, positions: [], accruals: [] });
    const w = inst.wallet;
    const balances = w ? await deskBalances(w.address) : null;
    const mine = trades.read().trades.filter((t) => t.seller.institution === inst.id || t.buyer.institution === inst.id);
    const names = Object.fromEntries(readOrg().institutions.map((i) => [i.id, i.name]));
    // Every asset on the register: this desk's par, and what the enclave released / the paying agent paid for it.
    const dep = readDeployment();
    const assets = await listAssets(dep);
    const addr = w?.address.toLowerCase();
    const positions = [];
    const accruals = [];
    for (const asset of assets) {
      const par = addr ? (await assetBalances(asset, [addr], dep)).balances.get(addr) ?? null : null;
      positions.push({ symbol: asset.symbol, name: asset.name, facilityType: asset.facilityType, par: par === null ? null : par.toString(), tradeable: asset.tradeable });
      const dist = readDistribution(asset.symbol);
      if (!dist || !addr) continue;
      const payout = readPayout(asset.symbol, dist.commitment);
      accruals.push({
        facilityId: dist.facilityId, periodId: dist.periodId, days: dist.days, commitment: dist.commitment,
        amountUnits: dist.distribution.find((x) => x.holder.toLowerCase() === addr)?.amountUnits ?? null,
        paid: payout?.paid.find((x) => x.holder.toLowerCase() === addr) ?? null,
        skipped: payout?.skipped.find((x) => x.holder.toLowerCase() === addr)?.reason ?? null,
        payoutLink: holderPayoutLink(payout, addr),
      });
    }
    return Response.json({ institution: { id: inst.id, name: inst.name, wallet: w ?? null, hedera: onboardingOf(inst) }, balances, trades: mine.sort((a, b) => b.createdAt - a.createdAt), names, positions, accruals });
  } catch (e) {
    return jsonError(e);
  }
}
