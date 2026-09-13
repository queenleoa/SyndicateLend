import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { jsonError } from "@/lib/privy-server";
import { optionalDesk } from "@/lib/desk-auth";
import { readOrg } from "@/lib/org";
import { deskBalances, onboardingOf } from "@/lib/onboarding";
import { venue } from "@/lib/venue";
import { HEDERA_RPC } from "@/lib/hedera";
import { colourFor } from "@/lib/agent";

export type HolderKind = "desk" | "automated" | "anchor" | "feeder" | "self-service";

/**
 * The lender register as the arranger keeps it: every holder of the tranche with its par, cash and
 * eligibility, whatever kind of holder it is (Privy desks, the automated desk, the anchor lenders
 * onboarded by script, and retail feeder holders shown as one pass-through line).
 */
export async function GET(req: Request) {
  try {
    const d = await optionalDesk(req);
    const dep = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../ops/deployments/testnet.json"), "utf8"));
    const org = readOrg();
    const v = venue();
    const provider = new JsonRpcProvider(HEDERA_RPC, undefined, { staticNetwork: true });
    const loan = new Contract(v.loanToken, ["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"], provider);

    const holders: { id: string; name: string; kind: HolderKind; wallet: string | null; accountId?: string; eligible: boolean; par: string; usd: string; colour: string; mine: boolean; hedera?: unknown }[] = [];
    for (const i of org.institutions) {
      const b = i.wallet ? await deskBalances(i.wallet.address).catch(() => null) : null;
      holders.push({ id: i.id, name: i.name, kind: i.automated ? "automated" : i.selfService ? "self-service" : "desk", wallet: i.wallet?.address ?? null, accountId: onboardingOf(i).accountId, eligible: Boolean((i as { loanEligible?: boolean }).loanEligible), par: b?.par ?? "0", usd: b?.usd ?? "0", colour: "", mine: d.institution?.id === i.id, hedera: onboardingOf(i) });
    }
    for (const a of (dep.institutions ?? []) as { name: string; role: string; evmAddress: string; accountId?: string; loanEligible?: boolean; usdKyc?: boolean }[]) {
      if (a.role === "outsider") continue;
      const b = await deskBalances(a.evmAddress).catch(() => null);
      holders.push({ id: `anchor:${a.evmAddress.toLowerCase()}`, name: a.name, kind: "anchor", wallet: a.evmAddress, accountId: a.accountId, eligible: Boolean(a.loanEligible), par: b?.par ?? "0", usd: b?.usd ?? "0", colour: "", mine: false });
    }
    const feeder = dep.feeder as { name?: string; holders?: { evmAddress: string; accountId: string }[] } | undefined;
    if (feeder?.holders?.length) {
      let par = 0n;
      for (const h of feeder.holders) par += (await loan.balanceOf(h.evmAddress).catch(() => 0n)) as bigint;
      holders.push({ id: "feeder", name: `${feeder.name ?? "Feeder"} pass-through (${feeder.holders.length} retail holders)`, kind: "feeder", wallet: null, eligible: true, par: par.toString(), usd: "0", colour: "", mine: false });
    }
    holders.sort((a, b) => Number(BigInt(b.par) - BigInt(a.par)));
    holders.forEach((h, i) => (h.colour = colourFor(i)));

    // Interest per holder from the latest released distribution and payout (feeder line aggregated).
    const evidenceDir = path.resolve(process.cwd(), "../cre/evidence");
    const readJson = <T,>(f: string): T | null => (fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null);
    const dist = readJson<{ facilityId: string; periodId: number; days: string; commitment: string; distribution: { holder: string; amountUnits: string }[]; totalUnits: string }>(path.join(evidenceDir, "distribution.json"));
    const payout = readJson<{ commitment: string; hashscan: string; paid: { holder: string; amountUnits: string }[]; skipped: { holder: string; reason: string }[] }>(path.join(evidenceDir, "payout.json"));
    const paidFor = payout && dist && payout.commitment.toLowerCase() === dist.commitment.toLowerCase() ? payout : null;
    const feederSet = new Set((feeder?.holders ?? []).map((h) => h.evmAddress.toLowerCase()));
    const accrualOf = (wallet: string | null, kind: HolderKind) => {
      if (!dist) return null;
      if (kind === "feeder") {
        const due = dist.distribution.filter((x) => feederSet.has(x.holder.toLowerCase())).reduce((a, x) => a + BigInt(x.amountUnits), 0n);
        const paid = (paidFor?.paid ?? []).filter((x) => feederSet.has(x.holder.toLowerCase())).reduce((a, x) => a + BigInt(x.amountUnits), 0n);
        return { periodId: dist.periodId, days: dist.days, amountUnits: due.toString(), paidUnits: paid.toString(), skipped: null, link: paidFor?.hashscan ?? null };
      }
      if (!wallet) return null;
      const w = wallet.toLowerCase();
      const due = dist.distribution.find((x) => x.holder.toLowerCase() === w)?.amountUnits ?? null;
      const paid = paidFor?.paid.find((x) => x.holder.toLowerCase() === w)?.amountUnits ?? null;
      const skipped = paidFor?.skipped.find((x) => x.holder.toLowerCase() === w)?.reason ?? null;
      return { periodId: dist.periodId, days: dist.days, amountUnits: due, paidUnits: paid, skipped, link: paidFor?.hashscan ?? null };
    };
    const enriched = holders.map((h) => ({ ...h, accrual: accrualOf(h.wallet, h.kind) }));
    const totalSupply = ((await loan.totalSupply().catch(() => 0n)) as bigint).toString();
    const outsider = ((dep.institutions ?? []) as { role: string; name: string; evmAddress: string; accountId?: string }[]).find((x) => x.role === "outsider") ?? null;
    return Response.json({ facility: dep.loanToken, mockUsd: dep.mockUsd, engine: dep.settlementEngine, topics: dep.topics, operator: dep.operator, registerSnapshot: dep.registerSnapshot ?? null, totalSupply, holders: enriched, period: dist ? { periodId: dist.periodId, days: dist.days, totalUnits: dist.totalUnits } : null, outsider, me: { institution: d.institution?.id ?? null } });
  } catch (e) {
    return jsonError(e);
  }
}
