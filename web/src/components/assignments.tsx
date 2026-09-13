"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/use-me";
import { assignmentNeedsConsent } from "@/lib/assignment-state";
import { HASHSCAN, money, par, when, ago, short } from "./ui";
import type { TradeView } from "./trade-lifecycle";
import s from "./assignments.module.css";

type Assignment = TradeView & {
  facility?: string;
  autoConsentEnabled?: boolean;
  demo?: { kind: "transfer-demo" | "agent-registry"; runId: string; manualConsent: true; automatedInstitutions: [string, string]; requestedBy?: string };
};
type DemoStatus = { configured: boolean; ready: boolean; seller: { id: string | null; name: string | null; ready: boolean; step: string }; buyer: { id: string | null; name: string | null; ready: boolean; step: string }; activeRfqId: string | null; par: string; price: string };
type Payload = {
  me: { userId: string; isAgent: boolean; institution: string | null };
  names: Record<string, string>;
  automated: string[];
  trades: Assignment[];
  demo: DemoStatus;
};

const closedStates = new Set(["Settled", "Cancelled", "Failed"]);
function needsConsent(t: Assignment) {
  return assignmentNeedsConsent(t);
}
function status(t: Assignment) {
  if (t.state === "PreparingApprovals") return { label: "Preparing approvals", tone: "pending" };
  if (needsConsent(t)) return { label: "Pending agent consent", tone: "pending" };
  if (t.state === "Settled") return { label: "Settled", tone: "settled" };
  if (t.state === "Failed" || t.state === "Cancelled") return { label: t.state, tone: "failed" };
  if (t.state === "Scheduled") return { label: "Scheduled", tone: "scheduled" };
  return { label: "Agent approved", tone: "approved" };
}

/** Agent consent and institution wallet authority are deliberately separate steps. */
export function Assignments() {
  const api = useApi();
  const [d, setD] = useState<Payload | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedRfq, setSelectedRfq] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const request = useRef<Promise<Payload | null> | null>(null);
  const mounted = useRef(false);

  const load = useCallback((): Promise<Payload | null> => {
    if (request.current) return request.current;
    if (mounted.current) setRefreshing(true);
    const pending = api("/api/assignments", { cache: "no-store" })
      .then((v: Payload) => {
        if (mounted.current) {
          setD(v);
          setErr(null);
          setUpdatedAt(Date.now());
          setSelectedRfq((previous) => v.trades.some((t) => t.rfqId === previous) ? previous : (v.trades.find(needsConsent) ?? v.trades[0])?.rfqId ?? null);
        }
        return v;
      })
      .catch((e: Error) => { if (mounted.current) setErr(e.message); return null; })
      .finally(() => { request.current = null; if (mounted.current) setRefreshing(false); });
    request.current = pending;
    return pending;
  }, [api]);

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      await load();
      if (!stopped) timer = setTimeout(poll, 5_000);
    }
    void poll();
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); };
  }, [load]);

  async function consent(t: Assignment) {
    setBusy(t.rfqId);
    setActionError(null);
    try {
      await api(`/api/assignments/${encodeURIComponent(t.tradeId)}/consent`, { method: "POST" });
      if (request.current) await request.current;
      await load();
      setConfirmation(null);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function createDemo() {
    setCreating(true);
    setActionError(null);
    try {
      const result = await api("/api/demo/transfer", { method: "POST" }) as { trade: Assignment };
      if (request.current) await request.current;
      await load();
      setSelectedRfq(result.trade.rfqId);
      setConfirmation(null);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const pending = d?.trades.filter(needsConsent).length ?? 0;
  const queue = [...(d?.trades ?? [])].sort((a, b) => {
    const rank = (t: Assignment) => needsConsent(t) ? 0 : closedStates.has(t.state ?? "") ? 2 : 1;
    return rank(a) - rank(b) || b.createdAt - a.createdAt;
  });
  const selected = d?.trades.find((t) => t.rfqId === selectedRfq);

  return (
    <section className={s.workspace} aria-labelledby="transfers-title">
      <header className={s.header}>
        <div><h1 id="transfers-title">Transfer requests <span>{pending} awaiting consent</span></h1><p>Review the agreed trade. Authorise the assignment. Follow settlement.</p></div>
        <div className={s.headerActions}><button className={s.refresh} onClick={() => void load()} disabled={refreshing} aria-label="Refresh transfer requests">{refreshing ? "Refreshing…" : "↻ Refresh"}</button>{d && !d.demo.activeRfqId && <button className={s.primary} onClick={() => void createDemo()} disabled={creating || !d.demo.configured}>{creating ? "Agreeing the trade on HCS…" : "Create a demo transfer request"}</button>}</div>
      </header>

      {err && <div className={s.error} role="alert">{err} {d && <span>Showing the last received records.</span>}</div>}
      {actionError && <div className={s.error} role="alert">{actionError}</div>}
      {d && <DemoPanel demo={d.demo} creating={creating} onCreate={() => void createDemo()} />}

      {!d ? <div className={s.empty} role="status"><h2>{err ? "Unable to load transfer requests" : "Loading transfer requests…"}</h2><p>{err ? "Refresh to try again." : "Reading the venue’s assignment records."}</p></div> : (
        <div className={s.layout}>
          <aside className={s.queue} aria-label="Transfer request queue">
            <div className={s.queueHeader}><strong>Request queue</strong><span>{d.trades.length}</span></div>
            <div className={s.queueList}>
              {queue.length === 0 && <p className={s.noRequests}>Accepted RFQ trades appear here for your consent.</p>}
              {queue.map((t) => {
                const st = status(t);
                return <button key={t.rfqId} className={`${s.queueItem} ${selectedRfq === t.rfqId ? s.selected : ""}`} onClick={() => { setSelectedRfq(t.rfqId); setConfirmation(null); setActionError(null); }} aria-pressed={selectedRfq === t.rfqId}>
                  <span className={s.queueTop}><strong>${par(t.par)}</strong><span>{ago(t.createdAt)}</span></span>
                  <span className={s.queueParties}>{d.names[t.seller.institution] ?? t.seller.institution}<span aria-hidden="true"> → </span>{d.names[t.buyer.institution] ?? t.buyer.institution}</span>
                  <span className={`${s.status} ${s[st.tone]}`}>{st.label}</span>
                </button>;
              })}
            </div>
            <div className={s.queueFooter}>{updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString("en-GB")}` : "Waiting for records"}</div>
          </aside>

          {selected ? <div className={s.detail}>
            <div className={s.detailHeader}>
              <div className={s.facilityHeading}><h2>{selected.facility || "Secondary-market transfer"}</h2><span className={s.label}>Loan assignment</span></div>
              <div className={s.sponsor}><Image src="/integrations/hedera.svg" alt="Hedera" width={108} height={30} /><span>Atomic settlement</span></div>
            </div>

            {selected.demo && <div className={s.demoLabel}>Demo transfer between two automated institutions. Both sign with their own automated quorums after your consent.</div>}

            <div className={s.exchange}>
              <Party name={d.names[selected.seller.institution] ?? selected.seller.institution} role="Seller · current lender" />
              <div className={s.flows}>
                <div><span>Loan principal</span><strong>${par(selected.par)} <b aria-hidden="true">→</b></strong></div>
                <div><span>Settlement payment</span><strong><b aria-hidden="true">←</b> ${money(selected.cash)} <small>mUSD</small></strong></div>
              </div>
              <Party name={d.names[selected.buyer.institution] ?? selected.buyer.institution} role="Buyer · incoming lender" buyer />
            </div>

            <dl className={s.terms}><div><dt>Agreed price</dt><dd>{selected.price}% of par</dd></div><div><dt>Trade agreed</dt><dd>{when(selected.createdAt)}</dd></div><div><dt>Settlement target</dt><dd>{when(selected.settleAt)}</dd></div></dl>

            {needsConsent(selected) ? <div className={s.consent}>
              <div><strong>{confirmation === selected.rfqId ? "Confirm your consent as agent bank" : selected.state === "PreparingApprovals" ? "Institution approvals need preparation" : "Your consent is required"}</strong><p>{confirmation === selected.rfqId ? "Create the settlement instruction and request both institutions’ wallet approvals." : selected.state === "PreparingApprovals" ? "Retry approval to finish preparing the institution wallet intents." : selected.autoConsentEnabled ? "Agent automation is enabled for this request. You can approve it now." : "The institutions have agreed terms. Approve this assignment to proceed."}</p></div>
              {(d.me.isAgent || selected.demo?.kind === "transfer-demo") ? <div className={s.consentButtons}>
                {confirmation === selected.rfqId && <button className={s.secondary} disabled={busy !== null} onClick={() => setConfirmation(null)}>Back</button>}
                <button className={s.primary} disabled={busy !== null} onClick={() => confirmation === selected.rfqId ? void consent(selected) : setConfirmation(selected.rfqId)}>{busy === selected.rfqId ? "Recording consent…" : confirmation === selected.rfqId ? "Confirm agent approval" : selected.state === "PreparingApprovals" ? "Retry agent approval" : "Approve transfer request"}</button>
              </div> : <span className={s.agentOnly}>Agent-bank access required</span>}
            </div> : <div className={`${s.outcome} ${selected.state === "Settled" ? s.success : selected.state === "Failed" || selected.state === "Cancelled" ? s.unsuccessful : ""}`}>
              <div><strong>{selected.state === "Settled" ? "Settled. Loan position and cash exchanged." : selected.state === "Failed" ? "Settlement failed. Review the execution evidence." : selected.state === "Cancelled" ? "This transfer was cancelled." : selected.state === "Scheduled" ? "Scheduled on Hedera. Awaiting execution." : "Agent approved. Awaiting institution approvals."}</strong><p>{selected.state === "Settled" ? "The buyer’s token balance now records the transferred loan position." : selected.state === "Failed" ? selected.failureReason || "Open the receipts below for the reported failure." : selected.state === "Cancelled" ? "No further approvals are requested for this instruction." : "Each institution authorises its own side; agent consent does not replace desk approval."}</p></div>
              {selected.state === "Settled" && <Link className={s.primary} href="/register">View updated register ↗</Link>}
            </div>}

            <Progress t={selected} />

            {!needsConsent(selected) && <details className={s.approvals} key={`approvals-${selected.rfqId}`}>
              <summary className={s.approvalHeader}><span><i className={s.disclosure} aria-hidden="true">▸</i> Institution wallet approvals</span><span className={s.privyLogo}><Image src="/integrations/privy.png" alt="Privy" width={108} height={60} /></span></summary>
              <div className={s.approvalGrid}>{(["seller", "buyer"] as const).map((side) => {
                const approval = selected.approvals[side];
                return <div className={s.deskApproval} key={side}><div><strong>{d.names[selected[side].institution] ?? selected[side].institution}</strong><span>{approval.txHash ? "Approval broadcast to Hedera" : approval.broadcastError ? "Broadcast needs attention" : approval.intentStatus || "Awaiting signatures"}</span></div><b className={approval.txHash ? s.signed : ""}>{approval.signatures ?? "—"}/{approval.threshold ?? "—"}</b></div>;
              })}</div>
            </details>}

            <details className={s.evidence} key={selected.rfqId}>
              <summary>Source records &amp; transaction receipts <span>↗</span></summary>
              <dl><div><dt>RFQ</dt><dd>{selected.rfqId}</dd></div><div><dt>Instruction</dt><dd>{selected.tradeId.startsWith("pending-") ? "Created after agent consent" : `#${selected.tradeId}`}</dd></div>{selected.instructionHash && <div><dt>Instruction commitment</dt><dd>{selected.instructionHash}</dd></div>}</dl>
              <div className={s.receipts}>
                {selected.createTx && <EvidenceLink kind="transaction" value={selected.createTx} label="Settlement instruction" />}
                {selected.approvals.seller.txHash && <EvidenceLink kind="transaction" value={selected.approvals.seller.txHash} label="Seller approval" />}
                {selected.approvals.buyer.txHash && <EvidenceLink kind="transaction" value={selected.approvals.buyer.txHash} label="Buyer approval" />}
                {selected.scheduleAddress && <EvidenceLink kind="schedule" value={selected.scheduleAddress} label="Hedera schedule & execution" />}
              </div>
              {selected.state === "Settled" && <p>Settlement status is read from the engine. The schedule links to execution evidence; the instruction receipt is not a settlement receipt.</p>}
              {(["seller", "buyer"] as const).map((side) => selected.approvals[side].broadcastError && <p className={s.error} key={side}>{side} approval: {selected.approvals[side].broadcastError}</p>)}
            </details>
          </div> : <div className={s.empty}>
            <span className={s.emptyIcon} aria-hidden="true">⇄</span><h2>No transfer request yet</h2><p>Two institutions agree an RFQ trade.<br />You review it and consent here as the agent bank.</p>
            <button className={s.primary} onClick={() => void createDemo()} disabled={creating || !d.demo.configured}>{creating ? "Agreeing the trade on HCS…" : "Create a demo transfer request"}</button>
          </div>}
        </div>
      )}
    </section>
  );
}

function DemoPanel({ demo, creating, onCreate }: { demo: DemoStatus; creating: boolean; onCreate: () => void }) {
  const line = (p: DemoStatus["seller"], role: string) => <span key={role}><strong>{p.name ?? "Not provisioned"}</strong> · {role} · {p.ready ? "ready" : p.step}</span>;
  return <div className={s.demoPanel}>
    <div><strong>Live transfer approval, judge edition.</strong><p>{demo.activeRfqId ? "A demo transfer is waiting in the queue. Select it, review the terms and approve it as the agent bank. Settlement then runs by itself on Hedera." : `Ask two automated institutions to agree a $${Number(demo.par).toLocaleString("en-US")} assignment at ${demo.price}. Then approve it here as the agent bank.`}</p><div className={s.demoParties}>{line(demo.seller, "seller")}{line(demo.buyer, "buyer")}</div></div>
    {!demo.activeRfqId && <button className={s.primary} onClick={onCreate} disabled={creating || !demo.configured || !demo.ready}>{creating ? "Agreeing the trade on HCS…" : "Create a demo transfer request"}</button>}
  </div>;
}

function Party({ name, role, buyer }: { name: string; role: string; buyer?: boolean }) {
  return <div className={`${s.party} ${buyer ? s.buyer : ""}`}><span className={s.partyIcon} aria-hidden="true">{name.split(/\s+/).slice(0, 2).map((v) => v[0]).join("")}</span><span className={s.label}>{role}</span><strong>{name}</strong></div>;
}

function Progress({ t }: { t: Assignment }) {
  const pending = needsConsent(t);
  const settled = t.state === "Settled";
  const failed = t.state === "Failed" || t.state === "Cancelled";
  const deskDone = Boolean(t.approvals.seller.txHash && t.approvals.buyer.txHash);
  const scheduled = Boolean(t.scheduleAddress) || t.state === "Scheduled" || settled;
  const quorum = (side: "seller" | "buyer") => `${t.approvals[side].signatures ?? "—"}/${t.approvals[side].threshold ?? "—"} ${side}`;
  const steps = [
    { title: "Agent consent", detail: pending ? "Pending" : t.consent?.status === "granted" ? "Approved" : "Recorded", done: !pending, active: pending },
    { title: "Desk approvals", detail: pending ? "After consent" : `${quorum("seller")} · ${quorum("buyer")}`, done: deskDone, active: !pending && !deskDone && !failed },
    { title: "Hedera schedule", detail: scheduled ? "Scheduled" : "After approvals", done: scheduled, active: deskDone && !scheduled && !failed },
    { title: "Atomic settlement", detail: settled ? "Settled" : failed ? t.state! : "Awaiting execution", done: settled, active: scheduled && !settled && !failed, failed },
  ];
  return <ol className={s.progress} aria-label="Observed transfer progress">{steps.map((step, index) => <li key={step.title} className={step.failed ? s.stepFailed : step.done ? s.stepDone : step.active ? s.stepActive : ""} aria-current={step.active ? "step" : undefined}><span className={s.stepNumber}>{step.failed ? "×" : step.done ? "✓" : index + 1}</span><div><div className={s.stepHeading}><strong>{step.title}</strong>{index === 1 && <span className={s.stepPrivy}><Image src="/integrations/privy.png" alt="Privy" width={80} height={44} /></span>}</div><span>{step.detail}</span></div></li>)}</ol>;
}

function EvidenceLink({ kind, value, label }: { kind: "transaction" | "schedule"; value: string; label: string }) {
  return <a href={`${HASHSCAN}/${kind}/${value}`} target="_blank" rel="noreferrer" title={value}>{label} <span>{short(value)} ↗</span></a>;
}
