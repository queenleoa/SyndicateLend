"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/use-me";
import { HASHSCAN, Pill, Receipt, ago, money, par, short, when } from "./ui";
import type { TradeView } from "./trade-lifecycle";

type Rfq = { rfqId: string; side: "sell" | "buy"; par: string; institution: string; status: string; quotes: { quoteId: string; institution: string; price: string; settleAt: number }[]; consensusAt: string; sequence: number };
type Rfqs = { me: { institution: string; role: string }; names: Record<string, string>; topic: string; topicLink: string; rfqs: Rfq[] };
type Register = { facility: { name: string; symbol: string; tokenId: string; evmAddress: string; units: string; maturity: number }; engine: { address: string }; mockUsd: { tokenId: string }; topics: { notices: string }; holders: { id: string; name: string; eligible: boolean; par: string; usd: string; colour: string }[] };
type Trades = { trades: TradeView[] };
type Approvals = { intents: { intent_id: string; status: string; authorization_details: { threshold: number; members: { signed_at: number | null }[] }[] }[] };

export function ExecutionRoom() {
  const api = useApi();
  const [rfqs, setRfqs] = useState<Rfqs | null>(null);
  const [register, setRegister] = useState<Register | null>(null);
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [approvals, setApprovals] = useState<Approvals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(0);

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      api("/api/rfqs") as Promise<Rfqs>,
      api("/api/register") as Promise<Register>,
      api("/api/trades?sync=1") as Promise<Trades>,
      api("/api/approvals") as Promise<Approvals>,
    ]);
    if (results[0].status === "fulfilled") setRfqs(results[0].value);
    if (results[1].status === "fulfilled") setRegister(results[1].value);
    if (results[2].status === "fulfilled") setTrades(results[2].value.trades);
    if (results[3].status === "fulfilled") setApprovals(results[3].value);
    const firstFailure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    setError(firstFailure ? firstFailure.reason?.message ?? "One live source is unavailable" : null);
    setUpdated(Date.now());
  }, [api]);

  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(load, 8_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [load]);

  const latestTrade = trades[0];
  const latestRfq = rfqs?.rfqs[0];
  const pendingIntents = approvals?.intents.filter((i) => ["pending", "granted", "processing"].includes(i.status)) ?? [];
  const stage = latestTrade?.state === "Settled" ? 5 : latestTrade?.state === "Scheduled" || latestTrade?.state === "Failed" ? 4 : latestTrade && latestTrade.state !== "AwaitingAgentConsent" ? 3 : latestTrade ? 2 : latestRfq?.quotes.length ? 1 : 0;
  const names = rfqs?.names ?? {};
  const notional = latestTrade?.par ?? latestRfq?.par ?? "5000000";
  const price = latestTrade?.price ?? latestRfq?.quotes[0]?.price ?? "—";
  const cash = latestTrade?.cash ? `$${money(latestTrade.cash)}` : price !== "—" ? `$${(Number(notional) * Number(price) / 100).toLocaleString("en-US")}` : "Pending quote";
  const seller = latestTrade ? names[latestTrade.seller.institution] : latestRfq ? names[latestRfq.institution] : "Meridian Credit Partners";
  const buyer = latestTrade ? names[latestTrade.buyer.institution] : latestRfq?.quotes[0] ? names[latestRfq.quotes[0].institution] : "Eligible counterparty";
  const controls = useMemo(() => [
    { label: "ATS security", value: register?.facility.tokenId ?? "Connecting…", sub: "Whitelist + KYC at transfer", state: register ? "live" : "wait", href: register ? `${HASHSCAN}/contract/${register.facility.tokenId}` : undefined },
    { label: "HCS market tape", value: rfqs?.topic ?? "Connecting…", sub: `${rfqs?.rfqs.length ?? 0} RFQs consensus ordered`, state: rfqs ? "live" : "wait", href: rfqs?.topicLink },
    { label: "Privy desk policy", value: "2-of-3 quorum", sub: `${pendingIntents.length} actions awaiting signatures`, state: approvals ? "live" : "wait", href: "/approvals" },
    { label: "CRE confidential", value: "Nitro · us-west-2", sub: "Private notice → public distribution", state: "ready", href: "/lifecycle" },
  ], [register, rfqs, pendingIntents.length, approvals]);

  if (!rfqs && !register) return <div className="room-loading"><i /><span>Connecting to venue infrastructure…</span></div>;

  return (
    <div className="execution-room-page">
      <div className="room-header">
        <div><div className="room-eyebrow">EXECUTION ROOM / {register?.facility.symbol ?? "MHTLB-A"}</div><h1>{register?.facility.name ?? "Meridian Holdings Term Loan B"}</h1><p>Tranche A · USD · maturity {register ? new Date(register.facility.maturity * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" }) : "2031"} · synthetic testnet facility</p></div>
        <div className="room-live"><i /><span>Live sources</span><small>{updated ? `updated ${ago(updated)}` : "connecting"}</small></div>
      </div>
      {error && <div className="room-warning">Some live data is delayed: {error}. Available sources remain visible below.</div>}

      <section className="deal-board">
        <div className="deal-primary">
          <div className="deal-titlebar"><div><span>{latestTrade ? `TRADE #${latestTrade.tradeId}` : latestRfq ? `RFQ ${latestRfq.rfqId}` : "NEW EXECUTION"}</span><h2>{par(notional)} par at {price}</h2></div><Pill tone={latestTrade?.state === "Settled" ? "ok" : latestTrade?.state === "Failed" ? "bad" : "warn"} live>{latestTrade?.state ?? latestRfq?.status ?? "ready"}</Pill></div>
          <div className="economics-strip"><div><span>PAR VALUE</span><strong>${par(notional)}</strong></div><div><span>PRICE / 100</span><strong>{price}</strong></div><div><span>CASH CONSIDERATION</span><strong>{cash}</strong></div><div><span>SETTLEMENT</span><strong>{latestTrade ? when(latestTrade.settleAt) : "T+0"}</strong></div></div>
          <div className="counterparty-line"><Party name={seller ?? "Seller"} side="Delivers ATS loan tokens" letter="M" /><div className="dvp-mark"><span>LOAN</span><b>⇄</b><span>mUSD</span><small>ONE TRANSACTION</small></div><Party name={buyer ?? "Buyer"} side="Delivers permissioned cash" letter="H" right /></div>
          <div className="execution-stages">
            {[{ t: "RFQ & quote", s: latestRfq ? `HCS #${latestRfq.sequence}` : "Open market", link: "/blotter" }, { t: "Arranger consent", s: latestTrade ? (latestTrade.consent?.status === "pending" ? "awaiting the arranger" : latestTrade.consent?.auto ? "by automation" : "granted") : "Registry", link: "/assignments" }, { t: "Desk mandates", s: latestTrade ? `${sigCount(latestTrade)}/4 quorum signatures` : "Privy intents", link: "/approvals" }, { t: "Scheduled DvP", s: latestTrade?.scheduleAddress ? short(latestTrade.scheduleAddress) : "HSS execution", link: latestTrade?.scheduleAddress ? `${HASHSCAN}/schedule/${latestTrade.scheduleAddress}` : "/blotter" }, { t: "Final register", s: latestTrade?.state === "Settled" ? "Both legs final" : "Eligibility rechecked", link: "/register" }].map((x, i) => <Link key={x.t} href={x.link} className={`execution-stage ${i < stage ? "complete" : i === stage ? "current" : ""}`}><i>{i < stage ? "✓" : i + 1}</i><span><strong>{x.t}</strong><small>{x.s}</small></span></Link>)}
          </div>
          <div className="deal-actions"><Link className="btn btn-primary" href={latestTrade && stage === 3 ? "/approvals" : latestTrade && stage === 2 ? "/assignments" : "/blotter"}>{latestTrade && stage === 3 ? "Review desk approvals" : latestTrade && stage === 2 ? "Awaiting arranger consent" : "Open RFQ workspace"} <span>→</span></Link>{latestTrade?.createTx && <Receipt href={`${HASHSCAN}/transaction/${latestTrade.createTx}`}>Verify instruction</Receipt>}<span className="room-refresh" onClick={load}>↻ Refresh</span></div>
        </div>
        <aside className="control-stack"><div className="control-stack-head"><span>CONTROL PLANE</span><strong>What each network proves</strong></div>{controls.map((c) => <Control key={c.label} {...c} />)}</aside>
      </section>

      <section className="room-lower">
        <div className="card-flat room-panel"><div className="room-panel-head"><div><span>ELIGIBLE REGISTER</span><h3>Institutional holders</h3></div><Link href="/register">Full register →</Link></div><div className="holder-list">{register?.holders.slice(0, 6).map((h) => <div key={h.id}><span className="holder-avatar" style={{ background: h.colour }}>{h.name.slice(0, 1)}</span><div><strong>{h.name}</strong><small>{h.eligible ? "KYC + whitelist active" : "Transfer restricted"}</small></div><b>${par(h.par)}<small>PAR</small></b></div>)}</div></div>
        <div className="card-flat room-panel"><div className="room-panel-head"><div><span>CONFIDENTIAL LIFECYCLE</span><h3>Interest accrual</h3></div><Link href="/lifecycle">Inspect CRE flow →</Link></div><div className="privacy-mini"><div className="private-box"><span>PRIVATE</span><strong>Rate notice + nonce</strong><small>Fetched and processed inside the TEE</small></div><div className="privacy-arrow">→<small>ATTEST</small></div><div className="public-box"><span>PUBLIC OUTPUT</span><strong>Holder distributions</strong><small>No rate or private terms exposed</small></div></div><p className="privacy-note">The notice is checked against its salted HCS commitment before any accrual is released.</p></div>
      </section>
    </div>
  );
}

function sigCount(t: TradeView) { return (t.approvals.seller.signatures ?? 0) + (t.approvals.buyer.signatures ?? 0); }
function Party({ name, side, letter, right }: { name: string; side: string; letter: string; right?: boolean }) { return <div className={`deal-party ${right ? "right" : ""}`}><span>{letter}</span><div><small>{right ? "BUYER" : "SELLER"}</small><strong>{name}</strong><p>{side}</p></div></div>; }
function Control({ label, value, sub, state, href }: { label: string; value: string; sub: string; state: string; href?: string }) { const body = <><i className={`control-status ${state}`} /><div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div><b>↗</b></>; return href?.startsWith("/") ? <Link className="control-item" href={href}>{body}</Link> : <a className="control-item" href={href} target="_blank" rel="noreferrer">{body}</a>; }
