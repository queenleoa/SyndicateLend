import { jsonError, HttpError } from "@/lib/privy-server";
import { requireDesk, requireRole } from "@/lib/desk-auth";
import { loadRfqs } from "@/lib/rfq";
import { publish } from "@/lib/hcs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const d = await requireDesk(req);
    requireRole(d.member, ["trader", "pm", "compliance"], "cancelling");
    const { id } = await ctx.params;
    const { rfqs } = await loadRfqs();
    const rfq = rfqs.find((r) => r.rfqId === id);
    if (!rfq) throw new HttpError(404, "RFQ not found");
    if (rfq.institution !== d.institution.id) throw new HttpError(403, "only the RFQ owner cancels");
    if (rfq.status !== "open") throw new HttpError(409, `RFQ is ${rfq.status}`);
    return Response.json({ hcs: await publish({ type: "cancel", rfqId: id, institution: d.institution.id, by: d.userId }) });
  } catch (e) {
    return jsonError(e);
  }
}
