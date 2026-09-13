import fs from "node:fs";
import path from "node:path";
import { jsonError } from "@/lib/privy-server";
import { optionalDesk } from "@/lib/desk-auth";
import { deskBalances, onboardingOf } from "@/lib/onboarding";
import { trades } from "@/lib/trades";
import { readOrg } from "@/lib/org";

export async function GET(req: Request) {
  try {
    const d = await optionalDesk(req);
    const inst = d.institution;
    if (!inst) return Response.json({ observer: true, institution: null, balances: null, trades: [], names: {} });
    const w = inst.wallet;
    const balances = w ? await deskBalances(w.address) : null;
    const mine = trades.read().trades.filter((t) => t.seller.institution === inst.id || t.buyer.institution === inst.id);
    const names = Object.fromEntries(readOrg().institutions.map((i) => [i.id, i.name]));
    // Interest accruals for this desk's wallet: what the enclave computed and what the paying agent paid.
    const evidenceDir = path.resolve(process.cwd(), "../cre/evidence");
    const readJson = <T,>(f: string): T | null => (fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null);
    const dist = readJson<{ facilityId: string; periodId: number; days: string; commitment: string; distribution: { holder: string; amountUnits: string }[] }>(path.join(evidenceDir, "distribution.json"));
    const payout = readJson<{ periodId: number; commitment: string; hashscan: string; batches?: { hashscan: string; holders: number }[]; paid: { holder: string; accountId: string; amountUnits: string }[]; skipped: { holder: string; reason: string }[] }>(path.join(evidenceDir, "payout.json"));
    const addr = w?.address.toLowerCase();
    const accruals = dist && addr ? [{
      facilityId: dist.facilityId,
      periodId: dist.periodId,
      days: dist.days,
      commitment: dist.commitment,
      amountUnits: dist.distribution.find((x) => x.holder.toLowerCase() === addr)?.amountUnits ?? null,
      paid: payout && payout.commitment.toLowerCase() === dist.commitment.toLowerCase() ? payout.paid.find((x) => x.holder.toLowerCase() === addr) ?? null : null,
      skipped: payout && payout.commitment.toLowerCase() === dist.commitment.toLowerCase() ? payout.skipped.find((x) => x.holder.toLowerCase() === addr)?.reason ?? null : null,
      payoutLink: payout?.hashscan ?? null,
    }] : [];
    return Response.json({ institution: { id: inst.id, name: inst.name, wallet: w ?? null, hedera: onboardingOf(inst) }, balances, trades: mine.sort((a, b) => b.createdAt - a.createdAt), names, accruals });
  } catch (e) {
    return jsonError(e);
  }
}
