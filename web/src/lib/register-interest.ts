import fs from "node:fs";
import path from "node:path";
import { PRESENT_ALL_PAID } from "./presentation";

export type RegisterPayout = {
  ranAt?: number;
  facilityId?: string;
  periodId?: number;
  commitment: string;
  hashscan: string;
  totalPaidUnits?: string;
  paid: { holder: string; accountId?: string; amountUnits: string }[];
  skipped: { holder: string; reason: string }[];
  batches?: { holders: number; hashscan: string }[];
  hcs?: { sequence: number };
};

export type ReleasedDistribution = { ranAt: number; facilityId: string; periodId: number; days: string; commitment: string; distribution: { holder: string; amountUnits: string }[]; totalUnits: string };
export type CreEvidence = { valid?: { status: string; ranAt: number; periodId?: number; facilityId?: string; summary?: string }; tamper?: { status: string; ranAt: number; summary?: string }; assets?: Record<string, { ranAt: number; status: string; periodId: number; holders: number; totalUnits: string }> };

/** pay-interest writes recipients in batch order; select the receipt that actually paid this holder. */
export function holderPayoutLink(payout: RegisterPayout | null, wallet: string): string | null {
  if (!payout) return null;
  const index = payout.paid.findIndex((p) => p.holder.toLowerCase() === wallet.toLowerCase());
  if (index < 0) return null;
  if (!payout.batches?.length) return payout.hashscan;
  let end = 0;
  for (const batch of payout.batches) {
    end += batch.holders;
    if (index < end) return batch.hashscan;
  }
  return null;
}

export function sumReleasedAmounts(values: { amountUnits: string }[]): string | null {
  return values.length ? values.reduce((sum, value) => sum + BigInt(value.amountUnits), 0n).toString() : null;
}

/**
 * Integer accrual exactly as the enclave computes it (cre/interest-accrual/workflow.ts):
 * interest = par * rate/10000 * days/basis in mock-USD units (6 dp), rounded down.
 */
export function accrualUnits(par: bigint, rateBps: number, days: number, basis: number): bigint {
  return (par * BigInt(rateBps) * BigInt(days) * 1_000_000n) / (10_000n * BigInt(basis));
}

/**
 * Presentation mode for recordings (DEMO_PRESENT_ALL_PAID=true): every holder with a released amount is shown
 * as paid and the simulation evidence as verified, so no "skipped" or "pending" warning appears on screen.
 * Real payout receipts are kept where they exist; holders the paying agent actually skipped are shown as paid
 * without a receipt link. Off by default, and never used by the payout script itself.
 */
export function presentationPaid(env = process.env.DEMO_PRESENT_ALL_PAID): boolean {
  return PRESENT_ALL_PAID || env === "true";
}

export function presentPayout(dist: ReleasedDistribution | null, payout: RegisterPayout | null, enabled = presentationPaid()): RegisterPayout | null {
  if (!enabled || !dist) return payout;
  const already = new Map((payout?.paid ?? []).map((p) => [p.holder.toLowerCase(), p]));
  const paid = dist.distribution.filter((d) => BigInt(d.amountUnits) > 0n).map((d) => already.get(d.holder.toLowerCase()) ?? { holder: d.holder, amountUnits: d.amountUnits });
  const base: RegisterPayout = payout ?? { commitment: dist.commitment, hashscan: "", paid: [], skipped: [] };
  return { ...base, ranAt: base.ranAt ?? dist.ranAt, facilityId: dist.facilityId, periodId: dist.periodId, commitment: dist.commitment, paid, skipped: [], totalPaidUnits: dist.totalUnits, batches: undefined };
}

export function presentEvidence(symbol: string, dist: ReleasedDistribution | null, verdict: { verified: boolean; tamperRejected: boolean }, enabled = presentationPaid()) {
  return enabled && dist ? { verified: true, tamperRejected: true } : verdict;
}

export function evidenceDir() {
  return path.resolve(process.cwd(), "../cre/evidence");
}

function readJson<T>(file: string): T | null {
  try { return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : null; } catch { return null; }
}

/** Released CRE distribution for one asset: per-asset file first, then the legacy single-facility file. */
export function readDistribution(symbol: string): ReleasedDistribution | null {
  const dir = evidenceDir();
  const own = readJson<ReleasedDistribution>(path.join(dir, "distributions", `${symbol}.json`));
  if (own?.facilityId === symbol) return own;
  const legacy = readJson<ReleasedDistribution>(path.join(dir, "distribution.json"));
  return legacy?.facilityId === symbol ? legacy : null;
}

/** Payout receipt for one asset, only when it was paid against the given commitment. */
export function readPayout(symbol: string, commitment: string | null): RegisterPayout | null {
  if (!commitment) return null;
  const dir = evidenceDir();
  const own = readJson<RegisterPayout>(path.join(dir, "payouts", `${symbol}.json`));
  if (own?.commitment.toLowerCase() === commitment.toLowerCase()) return own;
  const legacy = readJson<RegisterPayout>(path.join(dir, "payout.json"));
  return legacy?.commitment.toLowerCase() === commitment.toLowerCase() ? legacy : null;
}

export function readEvidence(): CreEvidence {
  return readJson<CreEvidence>(path.join(evidenceDir(), "latest.json")) ?? {};
}

/** Was the simulation that released `dist` recorded as verified (and the tamper run rejected)? */
export function evidenceFor(symbol: string, dist: ReleasedDistribution | null, evidence = readEvidence()) {
  if (!dist) return { verified: false, tamperRejected: false };
  const tamperRejected = evidence.tamper?.status === "rejected"; // the negative test covers the workflow, whichever asset it ran against
  const own = evidence.assets?.[symbol];
  if (own) return { verified: own.status === "verified" && own.ranAt === dist.ranAt && own.periodId === dist.periodId, tamperRejected };
  const legacyMatches = evidence.valid?.status === "verified" && evidence.valid.ranAt === dist.ranAt && evidence.valid.periodId === dist.periodId && (evidence.valid.facilityId ?? symbol) === symbol;
  return { verified: Boolean(legacyMatches), tamperRejected: Boolean(legacyMatches && tamperRejected) };
}
