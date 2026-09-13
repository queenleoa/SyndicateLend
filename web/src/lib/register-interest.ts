import fs from "node:fs";
import path from "node:path";

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
