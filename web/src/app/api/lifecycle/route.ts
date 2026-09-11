import fs from "node:fs";
import path from "node:path";
import { requireDesk } from "@/lib/desk-auth";
import { jsonError } from "@/lib/privy-server";
import { notices } from "@/lib/notices";

type Evidence = { valid?: { ranAt: number; status: "verified"; summary?: string }; tamper?: { ranAt: number; status: "rejected"; summary?: string } };

export async function GET(req: Request) {
  try {
    await requireDesk(req);
    const deployment = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../ops/deployments/testnet.json"), "utf8"));
    const publicNotices = notices.read().notices.map((n) => ({ facilityId: n.facilityId, periodId: n.periodId, periodStart: n.periodStart, periodEnd: n.periodEnd, holders: n.holders, commitment: n.commitment, createdAt: n.createdAt, hcs: n.hcs })).sort((a, b) => b.periodId - a.periodId);
    const evidencePath = path.resolve(process.cwd(), "../cre/evidence/latest.json");
    let evidence: Evidence = {};
    if (fs.existsSync(evidencePath)) evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8")) as Evidence;
    return Response.json({
      notices: publicNotices,
      evidence,
      topic: deployment.topics.notices,
      loanToken: deployment.loanToken,
      confidential: ["all-in rate", "day-count basis", "private nonce", "authenticated notice response"],
      released: ["commitment", "period id", "holder addresses", "distribution amounts"],
      tee: { type: "AWS Nitro", region: "us-west-2", deployment: "private beta" },
    });
  } catch (e) {
    return jsonError(e);
  }
}
