import { optionalDesk } from "@/lib/desk-auth";
import { jsonError } from "@/lib/privy-server";
import { notices } from "@/lib/notices";
import { findAsset, listAssets, readDeployment } from "@/lib/assets";
import { readDistribution, readEvidence, readPayout } from "@/lib/register-interest";

export const maxDuration = 60;

/** Interest workflow evidence for one asset (?facility=SYMBOL, default: the first tranche). */
export async function GET(req: Request) {
  try {
    await optionalDesk(req);
    const deployment = readDeployment();
    const assets = await listAssets(deployment);
    const url = new URL(req.url);
    const asset = findAsset(assets, url.searchParams.get("facility")) ?? assets.find((a) => a.symbol === deployment.loanToken.symbol) ?? assets[0];
    const symbol = asset?.symbol ?? deployment.loanToken.symbol;
    const publicNotices = notices.read().notices.filter((n) => n.facilityId === symbol).map((n) => ({ facilityId: n.facilityId, periodId: n.periodId, periodStart: n.periodStart, periodEnd: n.periodEnd, holders: n.holders, commitment: n.commitment, createdAt: n.createdAt, hcs: n.hcs })).sort((a, b) => b.periodId - a.periodId);
    const evidence = readEvidence();
    const distribution = readDistribution(symbol);
    const payout = readPayout(symbol, distribution?.commitment ?? null);
    const own = evidence.assets?.[symbol];
    return Response.json({
      facility: symbol,
      assets: assets.map((a) => ({ symbol: a.symbol, name: a.name })),
      notices: publicNotices,
      evidence: { valid: own ? { ranAt: own.ranAt, status: own.status, summary: `Commitment matched; accrual report generated for ${own.holders} holders (${symbol}).`, periodId: own.periodId } : evidence.valid?.facilityId === symbol || (!evidence.valid?.facilityId && symbol === deployment.loanToken.symbol) ? evidence.valid : undefined, tamper: evidence.tamper },
      distribution,
      payout,
      topic: deployment.topics.notices,
      loanToken: asset ? { tokenId: asset.tokenId, evmAddress: asset.evmAddress } : deployment.loanToken,
      mockUsd: deployment.mockUsd,
      confidential: ["all-in rate", "day-count basis", "private nonce", "authenticated notice response"],
      released: ["commitment", "period id", "holder addresses", "distribution amounts"],
      tee: { type: "AWS Nitro", region: "us-west-2", deployment: "private beta" },
    }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return jsonError(e);
  }
}
