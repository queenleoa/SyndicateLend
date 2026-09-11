"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/use-me";
import { HASHSCAN, Pill, Receipt, ago, short, when } from "./ui";

type Notice = { facilityId: string; periodId: number; periodStart: number; periodEnd: number; holders: string[]; commitment: string; createdAt: number; hcs?: { sequence: number; transactionId: string } };
type Evidence = { valid?: { ranAt: number; status: "verified"; summary?: string }; tamper?: { ranAt: number; status: "rejected"; summary?: string } };
type Payload = { notices: Notice[]; evidence: Evidence; topic: string; loanToken: { tokenId: string; evmAddress: string }; confidential: string[]; released: string[]; tee: { type: string; region: string; deployment: string } };

const stages = [
  { n: "01", system: "ADMINISTRATIVE AGENT", title: "Commit private notice", text: "A salted hash is published. Rate economics and the nonce stay off-ledger.", privacy: "public commitment" },
  { n: "02", system: "CHAINLINK CRE", title: "Enter confidential handler", text: "handlerInTee registers the calculation for a hardware-isolated environment.", privacy: "attested enclave" },
  { n: "03", system: "INSIDE THE TEE", title: "Verify and calculate", text: "Fetch the authenticated notice, match its hash, read ATS balances and calculate integer accrual.", privacy: "data protected" },
  { n: "04", system: "DON REPORT", title: "Release distribution only", text: "Only holder addresses and payment amounts cross the confidentiality boundary.", privacy: "minimal output" },
];

export function InterestLifecycle() {
  const api = useApi();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api("/api/lifecycle").then((v) => { setData(v); setError(null); }).catch((e) => setError(e.message)), [api]);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);
  if (!data) return <div className="room-loading"><i /><span>{error ?? "Loading confidential lifecycle…"}</span></div>;
  const notice = data.notices[0];
  return <div className="lifecycle-page">
    <div className="room-header"><div><div className="room-eyebrow">FACILITY LIFECYCLE / CHAINLINK CRE</div><h1>Confidential interest accrual</h1><p>Prove the calculation without publishing the facility&apos;s private rate notice.</p></div><div className="tee-badge"><i /><div><strong>{data.tee.type}</strong><small>{data.tee.region} · {data.tee.deployment}</small></div></div></div>
    {error && <div className="room-warning">Evidence refresh delayed: {error}</div>}

    <section className="privacy-banner"><div><span>THE SECURITY BOUNDARY</span><h2>The workflow logic is visible. The data it computes over is not.</h2><p>Secrets, the private API response and intermediate rate calculation remain inside the enclave. The DON receives only the distribution required for settlement.</p></div><div className="privacy-legend"><span><i className="private" /> protected in TEE</span><span><i className="public" /> public / released</span></div></section>

    <section className="cre-pipeline">{stages.map((s, i) => <div className="cre-stage" key={s.n}><div className="cre-stage-top"><span>{s.n}</span><b>{s.system}</b></div><div className={`cre-node ${i === 1 || i === 2 ? "private" : "public"}`}><i>{i === 0 ? "#" : i === 1 ? "◇" : i === 2 ? "∑" : "✓"}</i><div><strong>{s.title}</strong><p>{s.text}</p><small>{s.privacy}</small></div></div>{i < stages.length - 1 && <div className="cre-connector">→</div>}</div>)}</section>

    <section className="lifecycle-grid">
      <div className="card-flat lifecycle-card"><div className="room-panel-head"><div><span>LATEST PUBLIC COMMITMENT</span><h3>{notice ? `${notice.facilityId} · period ${notice.periodId}` : "No notice committed"}</h3></div>{notice?.hcs && <Receipt href={`${HASHSCAN}/topic/${data.topic}`}>HCS #{notice.hcs.sequence}</Receipt>}</div>{notice ? <><dl className="commitment-data"><div><dt>Commitment</dt><dd title={notice.commitment}>{short(notice.commitment, 16, 12)}</dd></div><div><dt>Accrual period</dt><dd>{when(notice.periodStart)} → {when(notice.periodEnd)}</dd></div><div><dt>Holder snapshot</dt><dd>{notice.holders.length} eligible desk wallets</dd></div><div><dt>Published</dt><dd>{ago(notice.createdAt)}</dd></div></dl><div className="not-on-ledger"><strong>Deliberately absent from Hedera</strong><div>{data.confidential.slice(0,3).map(x => <span key={x}>× {x}</span>)}</div></div></> : <p className="empty-copy">Publish a rate notice from Administration to create the HCS commitment.</p>}</div>
      <div className="card-flat lifecycle-card"><div className="room-panel-head"><div><span>SIMULATION EVIDENCE</span><h3>Positive and tamper paths</h3></div><button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button></div><EvidenceRow label="Committed notice" evidence={data.evidence.valid} expected="Calculation completes and returns a signed report" /><EvidenceRow label="Modified notice" evidence={data.evidence.tamper} expected="Commitment mismatch aborts before release" /><div className="simulation-command"><span>RUN BOTH TESTS</span><code>npm run demo:cre</code><p>The local simulator is not a real TEE; deployment requires Confidential Workflows private-beta access.</p></div></div>
    </section>

    <section className="boundary-table"><div><span>STAYS CONFIDENTIAL</span>{data.confidential.map(x => <p key={x}><i>◆</i>{x}</p>)}</div><b>TEE<br />BOUNDARY</b><div><span>MAY LEAVE THE ENCLAVE</span>{data.released.map(x => <p key={x}><i>◇</i>{x}</p>)}</div></section>
  </div>;
}

function EvidenceRow({ label, evidence, expected }: { label: string; evidence?: { ranAt: number; status: "verified" | "rejected"; summary?: string }; expected: string }) {
  return <div className="evidence-row"><div className={`evidence-icon ${evidence?.status ?? "pending"}`}>{evidence ? "✓" : "·"}</div><div><strong>{label}</strong><p>{evidence?.summary ?? expected}</p>{evidence && <small>captured {ago(evidence.ranAt)}</small>}</div><Pill tone={evidence?.status === "verified" ? "ok" : evidence?.status === "rejected" ? "bad" : "warn"}>{evidence?.status ?? "not captured"}</Pill></div>;
}
