import { after } from "next/server";
import { jsonError } from "@/lib/privy-server";
import { marketTick } from "@/lib/automated-desk";
import { optionalDesk, requireDesk, requireRole } from "@/lib/desk-auth";
import { loadRfqs, newId } from "@/lib/rfq";
import { publish, hashscanTopic, rfqTopicId } from "@/lib/hcs";
import { readOrg } from "@/lib/org";

export const maxDuration = 60;

export async function GET(req: Request) {
  try {
    const d = await optionalDesk(req);
    after(() => marketTick());
    const { rfqs } = await loadRfqs();
    const names = Object.fromEntries(readOrg().institutions.map((i) => [i.id, i.name]));
    const automatedDesk = readOrg().institutions.find((i) => i.automated)?.name ?? null;
    return Response.json({ me: { userId: d.userId, institution: d.institution?.id ?? null, role: d.member?.role ?? "observer" }, names, automatedDesk, topic: rfqTopicId(), topicLink: hashscanTopic(), rfqs });
  } catch (e) {
    return jsonError(e);
  }
}

/** Publish an RFQ. Body: { side: 'sell'|'buy', par: string (whole $), deadlineMinutes } */
export async function POST(req: Request) {
  try {
    const d = await requireDesk(req);
    requireRole(d.member, ["trader", "pm"], "publishing an RFQ");
    const b = await req.json();
    const par = BigInt(String(b.par).replace(/[^0-9]/g, ""));
    if (par <= 0n) throw new Error("par must be positive");
    const rfqId = newId("rfq");
    const r = await publish({
      type: "rfq",
      rfqId,
      facility: "MHTLB-A",
      side: b.side === "buy" ? "buy" : "sell",
      par: par.toString(),
      deadline: Math.floor(Date.now() / 1000) + 60 * Number(b.deadlineMinutes ?? 60),
      institution: d.institution.id,
      by: d.userId,
    });
    return Response.json({ rfqId, hcs: r });
  } catch (e) {
    return jsonError(e);
  }
}
