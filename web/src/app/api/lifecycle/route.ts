import fs from "node:fs";
import path from "node:path";
import { requireDesk } from "@/lib/desk-auth";
import { jsonError } from "@/lib/privy-server";
import { notices } from "@/lib/notices";

type Evidence = { valid?: { ranAt: number; status: "verified"; summary?: string }; tamper?: { ranAt: number; status: "rejected"; summary?: string } };

function readJson<T>(file: string): T | null {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null;
}

export async function GET(req: Request) {
  try {
    await requireDesk(req);
    const deployment = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../ops/deployments/testnet.json"), "utf8"));
    const publicNotices = notices.read().notices.map((n) => ({ facilityId: n.facilityId, periodId: n.periodId, periodStart: n.periodStart, periodEnd: n.periodEnd, holders: n.holders, commitment: n.commitment, createdAt: n.createdAt, hcs: n.hcs })).sort((a, b) => b.periodId - a.periodId);
    const evidenceDir = path.resolve(process.cwd(), "../cre/evidence");
    const evidence = readJson<Evidence>(path.join(evidenceDir, "latest.json")) ?? {};
    // Released workflow output (commitment, period, holders, amounts) and the mock-USD payout made from it.
    const distribution = readJson<{ ranAt: number; facilityId: string; periodId: number; commitment: string; days: string; distribution: { holder: string; amountUnits: string }[]; totalUnits: string }>(path.join(evidenceDir, "distribution.json"));
    const payout = readJson<{ ranAt: number; facilityId: string; periodId: number; commitment: string; transactionId: string; hashscan: string; totalPaidUnits: string; paid: { holder: string; accountId: string; amountUnits: string }[]; skipped: { holder: string; reason: string }[]; hcs?: { sequence: number } }>(path.join(evidenceDir, "payout.json"));
    return Response.json({
      notices: publicNotices,
      evidence,
      distribution,
      payout,
      topic: deployment.topics.notices,
      loanToken: deployment.loanToken,
      mockUsd: deployment.mockUsd,
      confidential: ["all-in rate", "day-count basis", "private nonce", "authenticated notice response"],
      released: ["commitment", "period id", "holder addresses", "distribution amounts"],
      tee: { type: "AWS Nitro", region: "us-west-2", deployment: "private beta" },
    });
  } catch (e) {
    return jsonError(e);
  }
}
