"use client";

import { Steps, type StepState, Ring, Receipt, HASHSCAN, money, par, when, ago, Pill } from "./ui";

export type TradeView = {
  tradeId: string;
  rfqId: string;
  instructionHash: string;
  createTx: string;
  seller: { institution: string; wallet: string };
  buyer: { institution: string; wallet: string };
  par: string;
  price: string;
  cash: string;
  settleAt: number;
  expiresAt: number;
  approvals: Record<"seller" | "buyer", { institution: string; intentId: string; intentStatus?: string; signatures?: number; threshold?: number; txHash?: string; broadcastError?: string }>;
  consent?: { status: "pending" | "granted"; requestedAt: number; grantedAt?: number; grantedBy?: string; auto?: boolean };
  state?: string;
  scheduleAddress?: string;
  failureReason?: string;
  settledAt?: number;
  createdAt: number;
};

export function lifecycle(t: TradeView): { title: string; sub?: string; state: StepState }[] {
  const s = t.state ?? "AwaitingApprovals";
  const bothBroadcast = !!(t.approvals.seller.txHash && t.approvals.buyer.txHash);
  const settled = s === "Settled";
  const failed = s === "Failed";
  const cancelled = s === "Cancelled";
  const scheduled = s === "Scheduled";
  const consentPending = t.consent?.status === "pending" || s === "AwaitingAgentConsent";
  const provisional = t.tradeId.startsWith("pending-");
  return [
    { title: "Quote accepted", sub: `RFQ ${t.rfqId.slice(0, 10)}…`, state: "done" },
    { title: "Arranger consent", sub: consentPending ? "awaiting the arranger" : t.consent ? `${t.consent.auto ? "automation" : "arranger"} ${t.consent.grantedAt ? ago(t.consent.grantedAt) : ""}` : "recorded", state: consentPending ? "active" : "done" },
    { title: "Instruction on-chain", sub: provisional ? "after consent" : `#${t.tradeId} · engine`, state: provisional ? "pending" : "done" },
    {
      title: "Desk approvals",
      sub: `${t.approvals.seller.signatures ?? 0}/${t.approvals.seller.threshold ?? 2} seller · ${t.approvals.buyer.signatures ?? 0}/${t.approvals.buyer.threshold ?? 2} buyer`,
      state: bothBroadcast || scheduled || settled || failed ? "done" : cancelled ? "failed" : provisional ? "pending" : "active",
    },
    {
      title: "Scheduled",
      sub: scheduled || settled || failed ? `${when(t.settleAt)}` : `for ${when(t.settleAt)}`,
      state: settled || failed ? "done" : scheduled ? "active" : cancelled ? "failed" : "pending",
    },
    {
      title: settled ? "Settled" : failed ? "Failed" : cancelled ? "Cancelled" : "Settlement",
      sub: settled ? `both legs moved ${t.settledAt ? ago(t.settledAt) : ""}` : failed ? "full revert, no balance changed" : "loan and cash in one transaction",
      state: settled ? "done" : failed || cancelled ? "failed" : "pending",
    },
  ];
}

export function TradeCard({ t, names, onOpenApprovals }: { t: TradeView; names: Record<string, string>; onOpenApprovals?: () => void }) {
  const tone = t.state === "Settled" ? "ok" : t.state === "Failed" || t.state === "Cancelled" ? "bad" : t.state === "Scheduled" ? "sky" : "warn";
  const label = t.state === "AwaitingAgentConsent" ? "Awaiting arranger consent" : t.state === "AwaitingApprovals" ? "Awaiting desk approvals" : (t.state ?? "AwaitingApprovals");
  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Pill tone={tone} live={t.state === "Scheduled" || t.state === "AwaitingApprovals" || t.state === "AwaitingAgentConsent"}>{label}</Pill>
            <span className="h2">
              {t.tradeId.startsWith("pending-") ? "Assignment" : `Trade #${t.tradeId}`} · {par(t.par)} par @ {t.price}
            </span>
          </div>
          <div className="mt-1 text-sm text-ink-muted">
            {names[t.seller.institution] ?? t.seller.institution} sells to {names[t.buyer.institution] ?? t.buyer.institution} for{" "}
            <span className="num font-medium text-ink">${money(t.cash)}</span> mUSD · settles {when(t.settleAt)}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-center">
            <div className="label mb-1">Seller</div>
            <Ring value={t.approvals.seller.signatures ?? 0} max={t.approvals.seller.threshold ?? 2} tone={t.approvals.seller.txHash ? "ok" : ""} />
          </div>
          <div className="text-center">
            <div className="label mb-1">Buyer</div>
            <Ring value={t.approvals.buyer.signatures ?? 0} max={t.approvals.buyer.threshold ?? 2} tone={t.approvals.buyer.txHash ? "ok" : ""} />
          </div>
        </div>
      </div>
      <div className="mt-6">
        <Steps items={lifecycle(t)} />
      </div>
      <div className="mt-5 pt-4 border-t border-line flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted">
        {t.createTx && (
          <span>
            Instruction <Receipt href={`${HASHSCAN}/transaction/${t.createTx}`} />
          </span>
        )}
        {t.approvals.seller.txHash && (
          <span>
            Seller approval <Receipt href={`${HASHSCAN}/transaction/${t.approvals.seller.txHash}`} />
          </span>
        )}
        {t.approvals.buyer.txHash && (
          <span>
            Buyer approval <Receipt href={`${HASHSCAN}/transaction/${t.approvals.buyer.txHash}`} />
          </span>
        )}
        {t.scheduleAddress && (
          <span>
            Schedule <Receipt href={`${HASHSCAN}/schedule/${t.scheduleAddress}`} />
          </span>
        )}
        {t.failureReason && <span className="text-bad">reason {t.failureReason.slice(0, 10)}…</span>}
        {t.instructionHash && <span className="mono">hash {t.instructionHash.slice(0, 10)}…</span>}
        {onOpenApprovals && t.state === "AwaitingApprovals" && (
          <button className="btn btn-ghost btn-sm ml-auto" onClick={onOpenApprovals}>
            Open approvals →
          </button>
        )}
      </div>
    </div>
  );
}
