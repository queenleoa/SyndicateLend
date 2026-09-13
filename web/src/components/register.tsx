"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/use-me";
import { PageHeader, Receipt, HASHSCAN, par, money, short, Pill } from "./ui";

type Accrual = { periodId: number; days: string; amountUnits: string | null; paidUnits: string | null; skipped: string | null; link: string | null } | null;
type Holder = { id: string; name: string; kind: "desk" | "automated" | "anchor" | "feeder" | "self-service"; wallet: string | null; accountId?: string; eligible: boolean; par: string; usd: string; colour: string; mine: boolean; accrual: Accrual; hedera?: { allowLoan?: { txHash?: string }; allowUsd?: { txHash?: string }; usdKycTx?: string } };
type Payload = {
  facility: { name: string; symbol: string; isin: string; tokenId: string; evmAddress: string; units: string; maturity: number; maxSupply?: string; documentRef: string };
  mockUsd: { tokenId: string; evmAddress: string; symbol: string };
  engine: { address: string };
  topics: { rfq: string; notices: string };
  operator: { accountId: string };
  registerSnapshot: { address: string } | null;
  totalSupply: string;
  holders: Holder[];
  period: { periodId: number; days: string; totalUnits: string } | null;
};

const KIND: Record<Holder["kind"], string> = { desk: "Institutional desk (Privy 2-of-3 quorum)", automated: "Automated liquidity desk (server-held quorum)", anchor: "Anchor lender (onboarded by the agent)", feeder: "Retail pass-through (feeder holders)", "self-service": "Institutional desk (Privy 2-of-3 quorum)" };

export function Register() {
  const api = useApi();
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    api("/api/register").then(setD).catch((e) => setErr(e.message));
    const t = setInterval(() => api("/api/register").then(setD).catch(() => {}), 15_000);
    return () => clearInterval(t);
  }, [api]);
  if (err) return <p className="text-sm text-bad">{err}</p>;
  if (!d) return <div className="room-loading"><i /><span>Reading the register from Hedera…</span></div>;
  const f = d.facility;
  const total = d.holders.reduce((a, h) => a + Number(h.par), 0) || 1;
  const withPar = d.holders.filter((h) => Number(h.par) > 0);
  const max = Math.max(...withPar.map((h) => Number(h.par)), 1);
  const sel = d.holders.find((h) => h.id === selected) ?? withPar[0] ?? null;
  return (
    <div>
      <PageHeader
        title="Lender register"
        sub={<>{f.symbol} · click a bar for the institution and its interest</>}
        right={<Link className="btn btn-primary" href="/assignments">Assignments awaiting consent →</Link>}
      />

      <section className="register-hero">
        <div className="register-hero-head">
          <div><span className="label">Tranche outstanding</span><strong>${par(d.totalSupply)}</strong><small>1 token = US$1 of par · maturity {new Date(f.maturity * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}</small></div>
          <div><span className="label">Holders</span><strong>{withPar.length}</strong><small>{d.holders.filter((h) => h.eligible).length} eligible institutions on the whitelist</small></div>
          <div><span className="label">Latest interest period</span><strong>{d.period ? `${money(d.period.totalUnits)} mUSD` : "—"}</strong><small>{d.period ? `period ${d.period.periodId} · ${d.period.days} days · computed confidentially` : "no accrual computed yet"}</small></div>
        </div>

        <div className="register-layout">
          <div>
            <div className="register-chart" role="list" aria-label="Par by holder">
              {withPar.map((h) => (
                <button key={h.id} type="button" role="listitem" className={`register-col ${sel?.id === h.id ? "selected" : ""} ${sel && sel.id !== h.id ? "dim" : ""}`} style={{ ["--c" as string]: h.colour }} onClick={() => setSelected(h.id)} aria-label={`${h.name}: ${par(h.par)} par`}>
                  <span className="amt">${par(h.par)}</span>
                  <div className="bar" style={{ height: `${Math.max(2, (Number(h.par) / max) * 100)}%` }} />
                </button>
              ))}
            </div>
            <div className="register-labels">
              {withPar.map((h) => (
                <div key={h.id}><strong>{h.name.length > 26 ? h.name.slice(0, 24) + "…" : h.name}</strong>{((Number(h.par) / total) * 100).toFixed(1)}%{h.mine ? " · you" : ""}</div>
              ))}
            </div>
          </div>

          {sel ? (
            <aside className="register-detail" style={{ ["--c" as string]: sel.colour }}>
              <div>
                <h3>{sel.name}{sel.mine && <span className="text-ink-muted font-normal"> · your desk</span>}</h3>
                <div className="kind">{KIND[sel.kind]}</div>
              </div>
              <div className="detail-grid">
                <div><span>Par held</span><strong>${par(sel.par)}</strong><small>{((Number(sel.par) / total) * 100).toFixed(1)}% of the tranche</small></div>
                <div><span>Cash</span><strong>${money(sel.usd)}</strong><small>mock USD on Hedera</small></div>
              </div>
              <div className="detail-section">
                <h4>Eligibility and settlement readiness</h4>
                <div className="detail-row"><dt>Register whitelist + KYC</dt><dd>{sel.eligible ? <Pill tone="ok">eligible</Pill> : <Pill tone="bad">not eligible</Pill>}</dd></div>
                {sel.hedera && sel.kind !== "anchor" && sel.kind !== "feeder" && (
                  <>
                    <div className="detail-row"><dt>Loan authorisation to engine</dt><dd>{sel.hedera.allowLoan?.txHash ? <Pill tone="ok">standing</Pill> : <Pill tone="warn">not set</Pill>}</dd></div>
                    <div className="detail-row"><dt>Cash authorisation to engine</dt><dd>{sel.hedera.allowUsd?.txHash ? <Pill tone="ok">standing</Pill> : <Pill tone="warn">not set</Pill>}</dd></div>
                    <div className="detail-row"><dt>Mock USD KYC</dt><dd>{sel.hedera.usdKycTx ? <Pill tone="ok">granted</Pill> : <Pill tone="warn">pending</Pill>}</dd></div>
                  </>
                )}
                {sel.wallet && <div className="detail-row"><dt>Wallet</dt><dd><Receipt href={`${HASHSCAN}/account/${sel.wallet}`}>{short(sel.wallet, 8, 6)}</Receipt></dd></div>}
                {sel.accountId && <div className="detail-row"><dt>Hedera account</dt><dd>{sel.accountId}</dd></div>}
              </div>
              <div className="detail-section">
                <h4>Interest{sel.accrual ? ` · period ${sel.accrual.periodId} (${sel.accrual.days} days)` : ""}</h4>
                {sel.accrual ? (
                  <>
                    <div className="detail-row"><dt>Accrued</dt><dd><strong>{sel.accrual.amountUnits ? `${money(sel.accrual.amountUnits)} mUSD` : "not in snapshot"}</strong></dd></div>
                    <div className="detail-row"><dt>Paid</dt><dd>{sel.accrual.paidUnits && sel.accrual.paidUnits !== "0" ? <span className="flex items-center gap-2 justify-end"><Pill tone="ok">{money(sel.accrual.paidUnits)} mUSD</Pill>{sel.accrual.link && <Receipt href={sel.accrual.link}>HTS</Receipt>}</span> : sel.accrual.skipped ? <Pill tone="warn">{sel.accrual.skipped}</Pill> : sel.accrual.amountUnits && sel.accrual.amountUnits !== "0" ? <Pill tone="warn">not paid yet</Pill> : <Pill>nothing due</Pill>}</dd></div>
                    <p className="text-xs text-ink-muted">Computed inside the confidential workflow from the private rate notice; only the amount is released.</p>
                  </>
                ) : (
                  <p className="text-xs text-ink-muted">No accrual period computed yet.</p>
                )}
              </div>
            </aside>
          ) : (
            <aside className="register-detail"><p className="register-empty">No holder has a position yet.</p></aside>
          )}
        </div>
      </section>

      <section className="mt-8 card-flat p-6">
        <h2 className="h2">Register infrastructure</h2>
        <dl className="mt-3 text-sm grid grid-cols-2 gap-x-10 gap-y-2">
          <Row k="Security (ATS diamond)" v={<Receipt href={`${HASHSCAN}/contract/${f.tokenId}`}>{f.tokenId} · {short(f.evmAddress, 8, 6)}</Receipt>} />
          <Row k="Maximum supply" v={<span className="num">{par(f.maxSupply ?? f.units)}</span>} />
          <Row k="Settlement engine" v={<Receipt href={`${HASHSCAN}/contract/${d.engine.address}`}>{short(d.engine.address, 8, 6)}</Receipt>} />
          <Row k="Payment token" v={<Receipt href={`${HASHSCAN}/token/${d.mockUsd.tokenId}`}>{d.mockUsd.symbol} {d.mockUsd.tokenId}</Receipt>} />
          <Row k="RFQ topic (HCS)" v={<Receipt href={`${HASHSCAN}/topic/${d.topics.rfq}`}>{d.topics.rfq}</Receipt>} />
          <Row k="Notice commitments (HCS)" v={<Receipt href={`${HASHSCAN}/topic/${d.topics.notices}`}>{d.topics.notices}</Receipt>} />
          {d.registerSnapshot && <Row k="Register snapshot reader" v={<Receipt href={`${HASHSCAN}/contract/${d.registerSnapshot.address}`}>{short(d.registerSnapshot.address, 8, 6)}</Receipt>} />}
          <Row k="Administrative agent" v={<Receipt href={`${HASHSCAN}/account/${d.operator.accountId}`}>{d.operator.accountId}</Receipt>} />
          <Row k="Credit agreement" v={<span className="mono text-xs">{f.documentRef}</span>} />
        </dl>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
