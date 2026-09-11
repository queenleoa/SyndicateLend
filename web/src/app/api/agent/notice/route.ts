import { findNotice } from "@/lib/notices";

/**
 * Private rate-notice endpoint for the confidential workflow. Requires the bearer token the
 * enclave fetches from the Vault DON (NOTICE_API_TOKEN here). Never served to browsers.
 *   GET /api/agent/notice?facility=MHTLB-A&period=1
 */
export async function GET(req: Request) {
  const expected = process.env.NOTICE_API_TOKEN;
  const auth = req.headers.get("authorization") ?? "";
  if (!expected || auth !== `Bearer ${expected}`) return Response.json({ error: "unauthorised" }, { status: 401 });
  const url = new URL(req.url);
  const facility = url.searchParams.get("facility") ?? "MHTLB-A";
  const period = Number(url.searchParams.get("period"));
  const n = findNotice(facility, period);
  if (!n) return Response.json({ error: "notice not found" }, { status: 404 });
  // The tamper switch lets the demo prove the enclave rejects a modified notice.
  const tamper = url.searchParams.get("tamper") === "1";
  const body = { facilityId: n.facilityId, periodId: n.periodId, periodStart: n.periodStart, periodEnd: n.periodEnd, rateBps: n.rateBps, dayCountBasis: n.dayCountBasis, holders: n.holders, nonce: n.nonce };
  return Response.json(tamper ? { ...body, rateBps: body.rateBps + 25 } : body, { headers: { "cache-control": "no-store" } });
}
