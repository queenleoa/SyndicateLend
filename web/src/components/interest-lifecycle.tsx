"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/use-me";
import { HASHSCAN, Pill, Receipt, ago, money, short, when } from "./ui";

type Notice = { facilityId: string; periodId: number; periodStart: number; periodEnd: number; holders: string[]; commitment: string; createdAt: number; hcs?: { sequence: number; transactionId: string } };
type Evidence = { valid?: { ranAt: number; status: "verified"; summary?: string }; tamper?: { ranAt: number; status: "rejected"; summary?: string } };
type Distribution = { ranAt: number; facilityId: string; periodId: number; commitment: string; days: string; distribution: { holder: string; amountUnits: string }[]; totalUnits: string };
type Payout = { ranAt: number; facilityId: string; periodId: number; commitment: string; transactionId: string; hashscan: string; totalPaidUnits: string; paid: { holder: string; accountId: string; amountUnits: string }[]; skipped: { holder: string; reason: string }[]; hcs?: { sequence: number } };
type Payload = { facility: string; holders: Record<string, { name: string; kind: string }>; assets: { symbol: string; name: string }[]; notices: Notice[]; evidence: Evidence; distribution: Distribution | null; payout: Payout | null; topic: string; loanToken: { tokenId: string | null; evmAddress: string }; mockUsd: { tokenId: string }; confidential: string[]; released: string[]; tee: { type: string; region: string; deployment: string } };

const STAGES = [
  { n: "01", who: "Agent bank", title: "Commit private notice", tone: "public" },
  { n: "02", who: "Chainlink CRE", title: "Enter confidential handler", tone: "private" },
  { n: "03", who: "Inside the TEE", title: "Verify and calculate", tone: "private" },
  { n: "04", who: "DON report", title: "Release distribution only", tone: "public" },
  { n: "05", who: "Paying agent", title: "Pay holders in mock USD", tone: "public" },
];

export function InterestLifecycle() {
  const api = useApi();
  const params = useSearchParams();
  const [facility, setFacility] = useState<string | null>(params.get("facility"));
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api(`/api/lifecycle${facility ? `?facility=${encodeURIComponent(facility)}` : ""}`, { cache: "no-store" }).then((v) => { setData(v); setError(null); }).catch((e) => setError(e.message)), [api, facility]);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);
  if (!data) return <div className="room-loading"><i /><span>{error ?? "Loading interest and payments…"}</span></div>;
  const notice = data.notices[0];
  const paidFor = data.payout && data.distribution && data.payout.commitment.toLowerCase() === data.distribution.commitment.toLowerCase() ? data.payout : null;
  const done = [Boolean(notice?.hcs), Boolean(data.evidence.valid), Boolean(data.evidence.valid), Boolean(data.distribution), Boolean(paidFor)];
  return <div className="lc">
    <header className="lc-head">
      <div><div className="room-eyebrow">FACILITY LIFECYCLE / CHAINLINK CRE</div><h1>Interest &amp; payments</h1></div>
      <div className="lc-head-right">
        <label className="lc-picker">Asset<select value={data.facility} onChange={(e) => { setData(null); setFacility(e.target.value); }}>{data.assets.map((a) => <option key={a.symbol} value={a.symbol}>{a.symbol} · {a.name}</option>)}</select></label>
        <span className="lc-tee" title={`${data.tee.region} · ${data.tee.deployment}`}><i />{data.tee.type} enclave</span>
        <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
      </div>
    </header>
    {error && <div className="room-warning">Evidence refresh delayed: {error}</div>}

    <PayoutPanel data={data} notice={notice} paidFor={paidFor} />

    <ol className="lc-pipeline" aria-label="Confidential accrual pipeline">{STAGES.map((s, i) => <li key={s.n} className={`${s.tone} ${done[i] ? "done" : ""}`}><b>{done[i] ? "✓" : s.n}</b><div><span>{s.who}</span><strong>{s.title}</strong></div></li>)}</ol>

    <section className="lc-grid">
      <div className="card-flat lc-card">
        <div className="lc-card-head"><div><span className="room-eyebrow">LATEST PUBLIC COMMITMENT</span><h3>{notice ? `${notice.facilityId} · period ${notice.periodId}` : "No notice committed"}</h3></div>{notice?.hcs && <Receipt href={`${HASHSCAN}/topic/${data.topic}`}>HCS #{notice.hcs.sequence}</Receipt>}</div>
        {notice ? <dl className="lc-facts"><div><dt>Commitment</dt><dd title={notice.commitment}>{short(notice.commitment, 12, 8)}</dd></div><div><dt>Period</dt><dd>{when(notice.periodStart)} → {when(notice.periodEnd)}</dd></div><div><dt>Snapshot</dt><dd>{notice.holders.length} eligible wallets</dd></div><div><dt>Published</dt><dd>{ago(notice.createdAt)}</dd></div><div><dt>Kept off-ledger</dt><dd>{data.confidential.slice(0, 3).join(" · ")}</dd></div></dl> : <p className="lc-empty">Publish a rate notice from Administration to create the HCS commitment.</p>}
      </div>
      <div className="card-flat lc-card">
        <div className="lc-card-head"><div><span className="room-eyebrow">SIMULATION EVIDENCE</span><h3>Positive and tamper paths</h3></div></div>
        <EvidenceRow label="Genuine notice" evidence={data.evidence.valid} expected="Calculation completes and returns a signed report" />
        <EvidenceRow label="Tampered notice (rate +25 bps)" evidence={data.evidence.tamper} expected="The enclave must refuse it and release nothing" />
        <p className="lc-cmd-line"><code>npm run demo:cre</code> runs both paths for every asset. The local simulator is not a real TEE; deployment needs Confidential Workflows access.</p>
      </div>
    </section>

    <details className="lc-boundary"><summary>Confidentiality boundary · what stays inside the enclave</summary><div>
      <div><span className="room-eyebrow">STAYS CONFIDENTIAL</span>{data.confidential.map((x) => <p key={x}><i>◆</i>{x}</p>)}</div>
      <div><span className="room-eyebrow">MAY LEAVE THE ENCLAVE</span>{data.released.map((x) => <p key={x}><i>◇</i>{x}</p>)}</div>
    </div></details>
  </div>;
}

function EvidenceRow({ label, evidence, expected }: { label: string; evidence?: { ranAt: number; status: "verified" | "rejected"; summary?: string }; expected: string }) {
  return <div className="lc-evidence"><span className={`lc-evidence-icon ${evidence?.status ?? "pending"}`}>{evidence ? "✓" : "·"}</span><div><strong>{label}</strong><span>{evidence?.summary ?? expected}{evidence && ` · ${ago(evidence.ranAt)}`}</span></div><Pill tone={evidence?.status === "verified" ? "ok" : evidence?.status === "rejected" ? "bad" : "warn"}>{evidence?.status ?? "not captured"}</Pill></div>;
}

const SKIP: Record<string, string> = { "no par in the register snapshot": "no par at payout time", "mock USD KYC not granted": "mUSD KYC not granted", "mock USD frozen": "mUSD frozen", "no Hedera account yet": "no Hedera account" };
const skipLabel = (reason: string) => reason.startsWith("mock USD not associated") ? "mUSD not associated · desk must sign" : SKIP[reason] ?? reason;

type Row = { key: string; name: string; sub: string; href: string | null; amount: bigint; paid: number; skipped: string | null; count: number };

/** FR-12: the released distribution and the mock-USD payout made from it, holders first. */
function PayoutPanel({ data, notice, paidFor }: { data: Payload; notice?: Notice; paidFor: Payout | null }) {
  const [showZero, setShowZero] = useState(false);
  const dist = data.distribution;
  const current = dist && notice && dist.commitment.toLowerCase() === notice.commitment.toLowerCase();
  const paidBy = new Map((paidFor?.paid ?? []).map((p) => [p.holder.toLowerCase(), p]));
  const skippedBy = new Map((paidFor?.skipped ?? []).map((p) => [p.holder.toLowerCase(), p.reason]));
  const rows = new Map<string, Row>();
  for (const d of dist?.distribution ?? []) {
    const addr = d.holder.toLowerCase();
    const who = data.holders[addr];
    const grouped = who?.kind === "feeder";
    const key = grouped ? `feeder:${who.name}` : addr;
    const paid = paidBy.get(addr);
    const reason = skippedBy.get(addr) ?? null;
    const row = rows.get(key) ?? { key, name: who?.name ?? short(addr, 8, 6), sub: grouped ? "" : addr, href: grouped ? null : `${HASHSCAN}/account/${addr}`, amount: 0n, paid: 0, skipped: null, count: 0 };
    row.amount += BigInt(d.amountUnits); row.count += 1;
    if (paid) row.paid += 1; else if (reason && !row.skipped) row.skipped = reason;
    if (paid && !grouped) row.sub = `paid to ${paid.accountId}`;
    rows.set(key, row);
  }
  const all = [...rows.values()].sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));
  const zero = all.filter((r) => r.amount === 0n);
  const shown = showZero ? all : all.filter((r) => r.amount > 0n);
  const paidTotal = BigInt(paidFor?.totalPaidUnits ?? "0");
  const total = BigInt(dist?.totalUnits ?? "0");
  const outstanding = all.filter((r) => r.amount > 0n && r.paid < r.count).length;
  return <section className="card-flat lc-payout" aria-label="Released distribution and payout">
    <div className="lc-payout-head">
      <div><span className="room-eyebrow">RELEASED DISTRIBUTION &amp; PAYOUT</span><h2>{dist ? `${dist.facilityId} · period ${dist.periodId} · ${dist.days} days` : "No distribution released yet"}</h2></div>
      {dist && <dl className="lc-stats">
        <div><dt>Computed</dt><dd>{money(total)} <small>mUSD</small></dd></div>
        <div><dt>Paid on-chain</dt><dd>{paidFor ? money(paidTotal) : "—"} <small>{paidFor ? `${paidFor.paid.length} holders` : "not paid"}</small></dd></div>
        <div><dt>Outstanding</dt><dd>{money(total - paidTotal)} <small>{outstanding ? `${outstanding} holder${outstanding === 1 ? "" : "s"}` : "none"}</small></dd></div>
        <div><dt>Receipt</dt><dd>{paidFor ? <><Receipt href={paidFor.hashscan}>HTS transfer</Receipt>{paidFor.hcs && <> · <a href={`${HASHSCAN}/topic/${data.topic}`} target="_blank" rel="noreferrer">HCS #{paidFor.hcs.sequence}</a></>}</> : <Pill tone="warn">not paid</Pill>}</dd></div>
      </dl>}
    </div>
    {dist ? <>
      {!current && <div className="room-warning">This distribution was released for an earlier commitment than the latest notice. Run the simulation again to refresh it.</div>}
      <div className="lc-table-wrap"><table className="grid lc-table"><thead><tr><th>Holder</th><th className="num">Interest due (mUSD)</th><th>Payment</th></tr></thead><tbody>
        {shown.map((r) => <tr key={r.key}>
          <td><strong>{r.href ? <a href={r.href} target="_blank" rel="noreferrer">{r.name}</a> : r.name}</strong>{r.count > 1 ? <span>{r.count} holders · {r.paid} paid</span> : r.sub && <span>{r.sub}</span>}</td>
          <td className="num">{money(r.amount)}</td>
          <td>{r.count > 1 ? <Pill tone={r.paid === r.count ? "ok" : r.paid ? "warn" : r.skipped ? "warn" : ""}>{r.paid === r.count ? "paid" : r.paid ? `${r.paid}/${r.count} paid` : r.skipped ? skipLabel(r.skipped) : paidFor ? "pending" : "not paid"}</Pill> : r.paid ? <Pill tone="ok">paid</Pill> : r.skipped ? <Pill tone={r.amount === 0n ? "" : "warn"}>{skipLabel(r.skipped)}</Pill> : <Pill tone={paidFor ? "warn" : ""}>{paidFor ? "pending" : "not paid"}</Pill>}</td>
        </tr>)}
      </tbody></table></div>
      <div className="lc-payout-foot">
        {zero.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setShowZero(!showZero)}>{showZero ? "Hide" : "Show"} {zero.length} holder{zero.length === 1 ? "" : "s"} with no par</button>}
        <details className="lc-cmd"><summary>Pay or catch up from the terminal</summary><code>npm run demo:payout -- --facility {dist.facilityId}{paidFor ? " --catch-up" : ""}</code><p>The paying agent mints the period’s interest on the test token and credits every eligible holder in one atomic HTS transfer. A holder skipped for a missing mock-USD association is paid by <code>--catch-up</code> once its desk quorum has signed the association on the Institution page; nobody is paid twice.</p></details>
      </div>
    </> : <p className="lc-empty">Run <code>npm run demo:cre</code>; the valid simulation releases the per-holder distribution that drives the payout.</p>}
  </section>;
}
