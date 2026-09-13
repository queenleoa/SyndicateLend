import { after } from "next/server";
import { jsonError } from "@/lib/privy-server";
import { marketTick } from "@/lib/automated-desk";
import { optionalDesk } from "@/lib/desk-auth";
import { assetBalances, creditAgreement, holderDirectory, listAssets, readDeployment, type Asset, type HolderEntry } from "@/lib/assets";
import { notices } from "@/lib/notices";
import { accrualUnits, evidenceFor, holderPayoutLink, presentEvidence, presentPayout, presentationPaid, readDistribution, readEvidence, readPayout, sumReleasedAmounts } from "@/lib/register-interest";

export const maxDuration = 60;

/**
 * The agent bank's loan register: one credit agreement, every asset issued under it, and each asset's
 * lenders with their par read live from the ATS security. Interest per asset comes from the last
 * released CRE distribution (or, before a run, the agent's own estimate from the committed notice).
 */
export async function GET(req: Request) {
  try {
    const d = await optionalDesk(req);
    after(() => marketTick());
    const dep = readDeployment();
    const assets = await listAssets(dep);
    const directory = holderDirectory(dep, d.institution?.id ?? null);
    const wallets = [...new Set(directory.flatMap((h) => h.wallets))];
    const evidence = readEvidence();
    const allNotices = notices.read().notices;
    const readAt = Date.now();

    const views = [];
    for (const asset of assets) {
      const { balances, totalSupply } = await assetBalances(asset, wallets, dep);
      const dist = readDistribution(asset.symbol);
      const payout = presentPayout(dist, readPayout(asset.symbol, dist?.commitment ?? null));
      const notice = allNotices.filter((n) => n.facilityId === asset.symbol).sort((a, b) => b.periodId - a.periodId)[0] ?? null;
      const { verified, tamperRejected } = presentEvidence(asset.symbol, dist, evidenceFor(asset.symbol, dist, evidence));
      const total = totalSupply ?? BigInt(asset.principal);
      const holders = directory.map((h) => holderView(h, balances, total, asset, dist, payout, notice)).filter((h) => h.par === null || BigInt(h.par) > 0n);
      const projectedTotal = !dist && notice ? holders.reduce((sum, h) => sum + BigInt(h.accrual?.amountUnits ?? "0"), 0n).toString() : null;
      views.push({
        ...asset,
        totalSupply: totalSupply === null ? null : totalSupply.toString(),
        unallocated: balances.get(dep.operator.evmAddress.toLowerCase())?.toString() ?? null,
        lenders: holders.filter((h) => h.kind !== "agent").length,
        holders,
        notice: notice ? { periodId: notice.periodId, periodStart: notice.periodStart, periodEnd: notice.periodEnd, commitment: notice.commitment, hcs: notice.hcs ?? null } : null,
        accrual: dist ? {
          kind: "released" as const, periodId: dist.periodId, days: dist.days, totalUnits: dist.totalUnits, commitment: dist.commitment, ranAt: dist.ranAt, verified, tamperRejected,
          current: presentationPaid() ? true : notice ? notice.commitment.toLowerCase() === dist.commitment.toLowerCase() : null,
          paidUnits: payout ? payout.paid.reduce((sum, p) => sum + BigInt(p.amountUnits), 0n).toString() : null, payoutLink: payout?.hashscan ?? null,
        } : notice ? { kind: "projected" as const, periodId: notice.periodId, days: String(Math.floor((notice.periodEnd - notice.periodStart) / 86400)), totalUnits: projectedTotal, commitment: notice.commitment, ranAt: null, verified: false, tamperRejected: false, current: true, paidUnits: null, payoutLink: null } : null,
      });
    }
    const principal = views.reduce((sum, a) => sum + BigInt(a.totalSupply ?? a.principal), 0n).toString();
    const lenders = new Set(views.flatMap((a) => a.holders.filter((h) => h.kind !== "agent").map((h) => h.id))).size;
    return Response.json({
      agreement: { ...creditAgreement(dep), operator: dep.operator, engine: dep.settlementEngine, topics: dep.topics, mockUsd: dep.mockUsd },
      totals: { principal, assets: views.length, lenders },
      assets: views,
      me: { institution: d.institution?.id ?? null, userId: d.userId },
      readAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}

type Dist = ReturnType<typeof readDistribution>;
type Payout = ReturnType<typeof readPayout>;
type Notice = { periodId: number; periodStart: number; periodEnd: number; rateBps: number; dayCountBasis: number } | null;

function holderView(h: HolderEntry, balances: Map<string, bigint | null>, total: bigint, asset: Asset, dist: Dist, payout: Payout, notice: Notice) {
  const reads = h.wallets.map((w) => balances.get(w) ?? null);
  const par = reads.some((b) => b === null) ? null : reads.reduce<bigint>((sum, b) => sum + (b ?? 0n), 0n);
  const share = par !== null && total > 0n ? Number((par * 10_000n) / total) / 100 : null;
  let accrual: { kind: "released" | "projected"; periodId: number; days: string; amountUnits: string | null; paidUnits: string | null; skipped: string | null; link: string | null } | null = null;
  const mine = new Set(h.wallets);
  if (dist) {
    const due = sumReleasedAmounts(dist.distribution.filter((x) => mine.has(x.holder.toLowerCase())));
    const paid = sumReleasedAmounts((payout?.paid ?? []).filter((x) => mine.has(x.holder.toLowerCase())));
    const skipped = payout?.skipped.find((x) => mine.has(x.holder.toLowerCase()))?.reason ?? null;
    const link = h.wallet ? holderPayoutLink(payout, h.wallet) : paid && BigInt(paid) > 0n ? payout?.hashscan ?? null : null;
    accrual = { kind: "released", periodId: dist.periodId, days: dist.days, amountUnits: due, paidUnits: paid, skipped, link };
  } else if (notice && par !== null) {
    const days = Math.floor((notice.periodEnd - notice.periodStart) / 86400);
    accrual = { kind: "projected", periodId: notice.periodId, days: String(days), amountUnits: accrualUnits(par, notice.rateBps, days, notice.dayCountBasis).toString(), paidUnits: null, skipped: null, link: null };
  }
  const allocation = asset.allocations.find((a) => h.wallets.includes(a.evmAddress));
  return { id: h.id, name: h.name, kind: h.kind, wallet: h.wallet, accountId: h.accountId, colour: h.colour, mine: h.mine, par: par === null ? null : par.toString(), share, allocatedPar: allocation?.par ?? null, allocationTx: allocation?.issueTx ?? null, accrual };
}
