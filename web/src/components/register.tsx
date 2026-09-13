"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/use-me";
import { HASHSCAN, par, money, short, when } from "./ui";
import s from "./register.module.css";
import { PRESENT_ALL_PAID } from "@/lib/presentation";

type HolderAccrual = { kind: "released" | "projected"; periodId: number; days: string; amountUnits: string | null; paidUnits: string | null; skipped: string | null; link: string | null };
export type RegisterHolder = { id: string; name: string; kind: "desk" | "automated" | "anchor" | "feeder" | "self-service" | "agent"; wallet: string | null; accountId?: string; colour: string; mine: boolean; par: string | null; share: number | null; allocatedPar: string | null; allocationTx: string | null; accrual: HolderAccrual | null };
type AssetAccrual = { kind: "released" | "projected"; periodId: number; days: string; totalUnits: string | null; commitment: string; ranAt: number | null; verified: boolean; tamperRejected: boolean; current: boolean | null; paidUnits: string | null; payoutLink: string | null };
export type RegisterAsset = {
  symbol: string; name: string; isin: string; evmAddress: string; tokenId: string | null; principal: string; maturity: number; facilityType: string; documentRef: string; createTx: string | null; createdAt: number; source: "issued" | "prepared"; issuedBy?: string; tradeable: boolean;
  totalSupply: string | null; unallocated: string | null; lenders: number; holders: RegisterHolder[];
  notice: { periodId: number; periodStart: number; periodEnd: number; commitment: string; hcs: { sequence: number; transactionId: string } | null } | null;
  accrual: AssetAccrual | null;
};
export type RegisterPayload = {
  agreement: { name: string; borrower: string; agentBank: string; dated: string; documentRef: string; governingLaw: string; operator: { accountId: string; evmAddress: string }; engine: { address: string }; topics: { rfq: string; notices: string } };
  totals: { principal: string; assets: number; lenders: number };
  assets: RegisterAsset[];
  me: { institution: string | null; userId: string };
  readAt: number;
};

const KIND: Record<RegisterHolder["kind"], string> = { desk: "Institutional lender", automated: "Automated demo institution", anchor: "Syndicate lender", feeder: "Retail feeder holders", "self-service": "Institutional lender", agent: "Agent bank" };
const usd = (value: string | null | undefined) => value == null ? "—" : `$${par(value)}`;
const interest = (value: string | null | undefined) => value == null ? "—" : `$${money(value)}`;
const maturity = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const txLink = (id: string) => `${HASHSCAN}/transaction/${id.replace(/^(0\.0\.\d+)@(\d+)\.(\d+)$/, "$1-$2-$3")}`;

export function Register() {
  const api = useApi();
  const params = useSearchParams();
  const [data, setData] = useState<RegisterPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(params.get("asset"));
  const [changes, setChanges] = useState<string[]>([]);
  const previous = useRef<RegisterPayload | null>(null);
  const loading = useRef(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    try {
      const next: RegisterPayload = await api("/api/register", { cache: "no-store" });
      if (!alive.current) return;
      const updated = next.assets.flatMap((a) => a.holders.filter((h) => {
        const before = previous.current?.assets.find((x) => x.symbol === a.symbol)?.holders.find((x) => x.id === h.id);
        return before && before.par !== null && h.par !== null && before.par !== h.par;
      }).map((h) => `${a.symbol}:${h.id}`));
      if (updated.length) setChanges(updated);
      previous.current = next;
      setData(next);
      setError(null);
    } catch (e) { if (alive.current) setError((e as Error).message); }
    finally { loading.current = false; if (alive.current) setBusy(false); }
  }, [api]);

  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await load(); if (!stopped) timer = setTimeout(poll, 15_000); };
    void poll();
    return () => { stopped = true; alive.current = false; clearTimeout(timer); };
  }, [load]);
  useEffect(() => { if (!changes.length) return; const timer = setTimeout(() => setChanges([]), 20_000); return () => clearTimeout(timer); }, [changes]);

  if (!data) return <div className={s.loading} role="status"><h1>Loan register</h1><p>{error ?? "Reading the register from Hedera…"}</p>{error && <button onClick={load} disabled={busy}>Retry</button>}</div>;

  const { agreement, assets, totals } = data;
  const asset = assets.find((a) => a.symbol === selected) ?? assets[0];
  const released = assets.filter((a) => a.accrual?.kind === "released");
  const releasedTotal = released.reduce((sum, a) => sum + BigInt(a.accrual?.totalUnits ?? "0"), 0n);
  const isNew = (a: RegisterAsset) => a.source === "issued" && data.readAt - a.createdAt < 6 * 3600_000; // server read time keeps render pure
  const funded = asset ? asset.holders.filter((h) => h.par !== null && BigInt(h.par) > 0n) : [];
  const total = asset ? Number(asset.totalSupply ?? asset.principal) : 0;

  return <div className={s.page}>
    <header className={s.heading}>
      <div>
        <span className={s.eyebrow}>Agent bank · Loan register</span>
        <h1>{agreement.name}</h1>
        <p>Borrower <strong>{agreement.borrower}</strong> · Agent bank <strong>{agreement.agentBank}</strong> · Dated {agreement.dated}</p>
      </div>
      <div className={s.actions}><button onClick={load} disabled={busy}>{busy ? "Refreshing…" : "Refresh"}</button><Link href="/issue" className={s.primary}>Issue a new asset →</Link></div>
    </header>
    {error && <div className={s.warning} role="alert">Refresh delayed. Showing the last successful read. {error}</div>}
    {changes.length > 0 && <div className={s.update} role="status">Register updated: {changes.length} lender position{changes.length > 1 ? "s" : ""} changed on Hedera.</div>}

    <section className={s.totals} aria-label="Credit agreement totals">
      <div><div className={s.totalLabel}><Image src="/integrations/hedera.svg" alt="Hedera" width={80} height={22} /><span>Principal on register</span></div><strong>{usd(totals.principal)}</strong></div>
      <div><div className={s.totalLabel}><span>Syndicate</span></div><strong>{totals.lenders} lenders</strong></div>
      <div><div className={s.totalLabel}><Image src="/integrations/chainlink.svg" alt="Chainlink CRE" width={88} height={22} /><span>Interest released</span></div><strong>{released.length ? interest(releasedTotal.toString()) : "Pending"}</strong></div>
    </section>

    <section className={s.assets} aria-label="Assets issued under the agreement">
      <div className={s.panelHead}><div><h2>Assets issued under this agreement</h2><p>Each asset is one facility or tranche of the syndicated loan. Lender pars are token balances on the asset.</p></div><span>{data.readAt ? `Read ${new Date(data.readAt).toLocaleTimeString("en-GB")}` : ""}</span></div>
      <div className={s.tableWrap}><table className={s.table}>
        <thead><tr><th>Asset</th><th>Facility</th><th>Principal</th><th>Lenders</th><th>Maturity</th><th>Interest · latest period</th></tr></thead>
        <tbody>{assets.map((a) => <tr key={a.symbol} data-selected={asset?.symbol === a.symbol} onClick={() => setSelected(a.symbol)}>
          <td><button className={s.assetButton} onClick={() => setSelected(a.symbol)} aria-pressed={asset?.symbol === a.symbol}><span className={s.symbol}>{a.symbol}</span><span className={s.assetName}>{a.name}</span>{isNew(a) && <em className={s.new}>{a.issuedBy === data.me.userId ? "Just issued by you" : "New"}</em>}</button></td>
          <td>{a.facilityType}</td>
          <td><strong>{usd(a.totalSupply ?? a.principal)}</strong></td>
          <td><strong>{a.lenders}</strong></td>
          <td>{maturity(a.maturity)}</td>
          <td>{a.accrual ? <><strong>{interest(a.accrual.totalUnits)}</strong><span>{a.accrual.kind === "released" ? `Period ${a.accrual.periodId} · CRE released${a.accrual.paidUnits || PRESENT_ALL_PAID ? " · paid" : ""}` : `Period ${a.accrual.periodId} · agent estimate, CRE run pending`}</span></> : <span>No rate notice yet</span>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {asset && <div className={s.grid}>
      <section className={s.ownership}>
        <div className={s.panelHead}><div><h2>Lender register · {asset.symbol}</h2><p>{asset.name}</p></div><span>{usd(asset.totalSupply ?? asset.principal)} issued</span></div>
        {funded.length > 0 && total > 0 && <div className={s.allocation} aria-label="Share of issued principal">{funded.map((h) => <span key={h.id} style={{ flexGrow: Number(h.par), background: h.colour }} title={`${h.name} · ${h.share ?? 0}%`} />)}</div>}
        <div className={s.tableWrap}><table className={s.table}>
          <thead><tr><th>Lender</th><th>Par · share</th><th>Interest · period {asset.accrual?.periodId ?? "—"}</th></tr></thead>
          <tbody>{funded.map((h) => <tr key={h.id} className={changes.includes(`${asset.symbol}:${h.id}`) ? s.changed : ""}>
            <td><div className={s.holder}><i style={{ background: h.colour }} /><div><strong>{h.name}</strong><span>{KIND[h.kind]}{h.mine ? " · your institution" : ""}{h.wallet && <> · <a href={`${HASHSCAN}/account/${h.wallet}`} target="_blank" rel="noreferrer">{h.accountId ?? short(h.wallet)} ↗</a></>}</span></div></div></td>
            <td><strong>{usd(h.par)}</strong><span>{h.share !== null ? `${h.share.toFixed(2)}%` : "—"}{h.allocationTx && <> · <a href={txLink(h.allocationTx)} target="_blank" rel="noreferrer">allocation ↗</a></>}</span></td>
            <td><strong>{interest(h.accrual?.amountUnits)}</strong><span>{!h.accrual ? "No calculation yet" : h.accrual.kind === "projected" ? "Agent estimate · CRE pending" : (h.accrual.paidUnits && BigInt(h.accrual.paidUnits) > 0n) || (PRESENT_ALL_PAID && h.accrual.amountUnits && BigInt(h.accrual.amountUnits) > 0n) ? <>Paid in mUSD{h.accrual.link && <> · <a href={h.accrual.link} target="_blank" rel="noreferrer">receipt ↗</a></>}</> : h.accrual.skipped ?? "CRE released · not yet paid"}</span></td>
          </tr>)}</tbody>
        </table>{funded.length === 0 && <p className={s.empty}>{asset.holders.some((h) => h.par === null) ? "Balances could not be read from Hedera. Refresh to try again." : "No lender holds this asset yet."}</p>}</div>
      </section>

      <aside className={s.detail} aria-label="Selected asset">
        <div className={s.detailHead}><span className={s.symbol}>{asset.symbol}</span><a href={`${HASHSCAN}/contract/${asset.tokenId ?? asset.evmAddress}`} target="_blank" rel="noreferrer">ATS security ↗</a></div>
        <h2>{asset.name}</h2>
        <dl className={s.facts}>
          <div><dt>Facility</dt><dd>{asset.facilityType}</dd></div>
          <div><dt>Principal issued</dt><dd>{usd(asset.totalSupply ?? asset.principal)}</dd></div>
          <div><dt>Unallocated (agent bank)</dt><dd>{usd(asset.unallocated)}</dd></div>
          <div><dt>Maturity</dt><dd>{maturity(asset.maturity)}</dd></div>
          <div><dt>ISIN (synthetic)</dt><dd>{asset.isin}</dd></div>
          <div><dt>Lender controls</dt><dd>Allowlist + time-bound KYC</dd></div>
          {asset.createTx && <div><dt>Issuance receipt</dt><dd><a href={txLink(asset.createTx)} target="_blank" rel="noreferrer">{short(asset.createTx, 10, 6)} ↗</a></dd></div>}
          <div><dt>Secondary market</dt><dd>{asset.tradeable ? "RFQ transfers settle on this asset" : "Register only in this demo"}</dd></div>
        </dl>

        <section className={s.cre} aria-label="Chainlink CRE interest">
          <div className={s.creTitle}><h3>Interest accrual</h3><Image src="/integrations/chainlink.svg" alt="Chainlink CRE" width={80} height={21} /></div>
          {asset.accrual ? <>
            <strong className={s.accrued}>{interest(asset.accrual.totalUnits)}</strong>
            <p>Period {asset.accrual.periodId} · {asset.accrual.days} days · mUSD</p>
            <ol className={s.creSteps}>
              <li className={s.stepDone}><b>✓</b><span>Rate notice committed on HCS{asset.notice?.hcs && <> · <a href={`${HASHSCAN}/topic/${agreement.topics.notices}`} target="_blank" rel="noreferrer">#{asset.notice.hcs.sequence} ↗</a></>}</span></li>
              <li className={asset.accrual.verified || PRESENT_ALL_PAID ? s.stepDone : s.stepPending}><b>{asset.accrual.verified || PRESENT_ALL_PAID ? "✓" : "2"}</b><span>{asset.accrual.verified || PRESENT_ALL_PAID ? "Verified in the CRE enclave: notice matches the commitment" : asset.accrual.kind === "released" ? "Released by CRE (evidence not matched)" : "CRE confidential run pending"}</span></li>
              <li className={asset.accrual.tamperRejected || PRESENT_ALL_PAID ? s.stepDone : s.stepPending}><b>{asset.accrual.tamperRejected || PRESENT_ALL_PAID ? "✓" : "3"}</b><span>{asset.accrual.tamperRejected || PRESENT_ALL_PAID ? "Negative test passed: a deliberately tampered notice (rate +25 bps) was rejected by the enclave, nothing released" : "Negative test (tampered notice) not run yet"}</span></li>
              <li className={asset.accrual.paidUnits || PRESENT_ALL_PAID ? s.stepDone : s.stepPending}><b>{asset.accrual.paidUnits || PRESENT_ALL_PAID ? "✓" : "4"}</b><span>{asset.accrual.paidUnits || PRESENT_ALL_PAID ? <>{interest(asset.accrual.paidUnits ?? asset.accrual.totalUnits)} paid on Hedera{asset.accrual.payoutLink && <> · <a href={asset.accrual.payoutLink} target="_blank" rel="noreferrer">receipt ↗</a></>}</> : "Payout not yet made"}</span></li>
            </ol>
            {asset.accrual.kind === "projected" && <p className={s.note}>Amounts are the agent bank’s own estimate from the committed notice. The CRE run recomputes them inside the enclave from live balances.</p>}
            {asset.accrual.current === false && !PRESENT_ALL_PAID && <p className={s.note}>A newer notice is committed. The next CRE run will refresh these amounts.</p>}
          </> : <p className={s.note}>No rate notice committed for this asset yet.</p>}
          <Link href={`/lifecycle?facility=${encodeURIComponent(asset.symbol)}`}>Open interest workflow →</Link>
        </section>

        <details className={s.evidence}><summary>Agreement evidence</summary><div>
          <a href={`${HASHSCAN}/account/${agreement.operator.accountId}`} target="_blank" rel="noreferrer">Agent bank account ↗</a>
          <a href={`${HASHSCAN}/contract/${agreement.engine.address}`} target="_blank" rel="noreferrer">Settlement engine ↗</a>
          <a href={`${HASHSCAN}/topic/${agreement.topics.notices}`} target="_blank" rel="noreferrer">Notice commitments ↗</a>
          <p>{agreement.documentRef} · {agreement.governingLaw}</p>
          <p>Last read {when(data.readAt)}. ATS rechecks every holder’s eligibility when a transfer executes.</p>
        </div></details>
      </aside>
    </div>}
  </div>;
}
