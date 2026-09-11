import { jsonError, HttpError } from "@/lib/privy-server";
import { requireDesk, requireRole } from "@/lib/desk-auth";
import { loadRfqs, newId } from "@/lib/rfq";
import { publish } from "@/lib/hcs";

/** Quote an RFQ. Body: { price: "99.25", settleInMinutes, validMinutes } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const d = await requireDesk(req);
    requireRole(d.member, ["trader", "pm"], "quoting");
    const { id } = await ctx.params;
    const { rfqs } = await loadRfqs();
    const rfq = rfqs.find((r) => r.rfqId === id);
    if (!rfq) throw new HttpError(404, "RFQ not found");
    if (rfq.status !== "open") throw new HttpError(409, `RFQ is ${rfq.status}`);
    if (rfq.institution === d.institution.id) throw new HttpError(400, "you cannot quote your own RFQ");
    const b = await req.json();
    const price = Number(b.price);
    if (!(price > 0 && price < 200)) throw new HttpError(400, "price must be per 100 par, e.g. 99.25");
    const now = Math.floor(Date.now() / 1000);
    const quoteId = newId("q");
    const r = await publish({
      type: "quote",
      rfqId: id,
      quoteId,
      price: price.toFixed(2),
      settleAt: now + 60 * Number(b.settleInMinutes ?? 5),
      expiresAt: now + 60 * Number(b.validMinutes ?? 120),
      institution: d.institution.id,
      by: d.userId,
    });
    return Response.json({ quoteId, hcs: r });
  } catch (e) {
    return jsonError(e);
  }
}
