import { jsonError, HttpError, requireSession } from "@/lib/privy-server";
import { createAndCommit, notices } from "@/lib/notices";

function requireOperator(userId: string) {
  const allowed = (process.env.PLATFORM_ADMIN_PRIVY_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length && !allowed.includes(userId)) throw new HttpError(403, "not a platform administrator");
}

/** Public view of notices: commitments and periods only, never the rate or nonce. */
export async function GET(req: Request) {
  try {
    await requireSession(req);
    const list = notices.read().notices.map((n) => ({ facilityId: n.facilityId, periodId: n.periodId, periodStart: n.periodStart, periodEnd: n.periodEnd, holders: n.holders, commitment: n.commitment, createdAt: n.createdAt, hcs: n.hcs }));
    return Response.json({ notices: list });
  } catch (e) {
    return jsonError(e);
  }
}

/** Body: { facilityId?, periodStart, periodEnd, rateBps, dayCountBasis? } (operator only) */
export async function POST(req: Request) {
  try {
    const s = await requireSession(req);
    requireOperator(s.userId);
    const b = await req.json();
    const n = await createAndCommit({ facilityId: b.facilityId ?? "MHTLB-A", periodStart: Number(b.periodStart), periodEnd: Number(b.periodEnd), rateBps: Number(b.rateBps), dayCountBasis: b.dayCountBasis ? Number(b.dayCountBasis) : 360 });
    const pub = { facilityId: n.facilityId, periodId: n.periodId, periodStart: n.periodStart, periodEnd: n.periodEnd, holders: n.holders, commitment: n.commitment, createdAt: n.createdAt, hcs: n.hcs };
    return Response.json({ notice: pub });
  } catch (e) {
    return jsonError(e);
  }
}
