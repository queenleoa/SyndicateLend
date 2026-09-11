import { jsonError, HttpError } from "@/lib/privy-server";
import { requireDesk, requireRole } from "@/lib/desk-auth";
import { loadRfqs, acceptQuote } from "@/lib/rfq";

/** Accept a quote (RFQ owner). Body: { quoteId } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const d = await requireDesk(req);
    requireRole(d.member, ["trader", "pm"], "accepting a quote");
    const { id } = await ctx.params;
    const { quoteId } = await req.json();
    const { rfqs } = await loadRfqs();
    const rfq = rfqs.find((r) => r.rfqId === id);
    if (!rfq) throw new HttpError(404, "RFQ not found");
    if (rfq.institution !== d.institution.id) throw new HttpError(403, "only the RFQ owner accepts");
    if (rfq.status !== "open") throw new HttpError(409, `RFQ is ${rfq.status}`);
    const quote = rfq.quotes.find((q) => q.quoteId === quoteId);
    if (!quote) throw new HttpError(404, "quote not found");
    if (quote.expiresAt < Date.now() / 1000) throw new HttpError(409, "quote expired");
    const trade = await acceptQuote(rfq, quote, d.userId);
    return Response.json({ trade });
  } catch (e) {
    return jsonError(e);
  }
}
