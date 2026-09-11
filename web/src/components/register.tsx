"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/use-me";
import { PageHeader, Stat, Receipt, HASHSCAN, par, money, short, Pill } from "./ui";

type Payload = {
  facility: { name: string; symbol: string; isin: string; tokenId: string; evmAddress: string; units: string; maturity: number; createTx: string; factory: string; resolver: string; documentRef: string };
  mockUsd: { tokenId: string; evmAddress: string; symbol: string };
  engine: { address: string };
  topics: { rfq: string; notices: string };
  operator: { accountId: string };
  legacyInstitutions: { name: string; role: string; evmAddress: string; accountId: string; loanEligible?: boolean }[];
  holders: { id: string; name: string; wallet: string | null; eligible: boolean; balances: { par: string; usd: string } | null }[];
};

export function Register() {
  const api = useApi();
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api("/api/register").then(setD).catch((e) => setErr(e.message));
  }, [api]);
  if (err) return <p className="text-sm text-bad">{err}</p>;
  if (!d) return <p className="text-sm text-ink-muted">Loading…</p>;
  const f = d.facility;
  return (
    <div>
      <PageHeader title="Facility register" sub={`${f.name} · ${f.symbol} · ISIN ${f.isin}`} />
      <div className="grid grid-cols-4 gap-3">
        <Stat k="Tranche size (US$ par)" v={par(f.units)} sub="1 token = US$1 par" />
        <Stat k="Maturity" v={new Date(f.maturity * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} sub="bond-type ATS security" />
        <Stat k="Compliance" v={<Pill tone="ok">whitelist + KYC</Pill>} sub="checked inside every transfer" />
        <Stat k="Regulation" v="Reg S" sub="offshore institutional" />
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3">
        <div className="card-flat p-5">
          <h2 className="h2">Register infrastructure</h2>
          <dl className="mt-3 text-sm space-y-2">
            <Row k="Security (ATS diamond)" v={<Receipt href={`${HASHSCAN}/contract/${f.tokenId}`}>{f.tokenId} · {short(f.evmAddress, 8, 6)}</Receipt>} />
            <Row k="ATS factory / resolver" v={<span className="mono text-xs">{f.factory} / {f.resolver}</span>} />
            <Row k="Settlement engine" v={<Receipt href={`${HASHSCAN}/contract/${d.engine.address}`}>{short(d.engine.address, 8, 6)}</Receipt>} />
            <Row k="Payment token" v={<Receipt href={`${HASHSCAN}/token/${d.mockUsd.tokenId}`}>{d.mockUsd.symbol} {d.mockUsd.tokenId}</Receipt>} />
            <Row k="RFQ topic (HCS)" v={<Receipt href={`${HASHSCAN}/topic/${d.topics.rfq}`}>{d.topics.rfq}</Receipt>} />
            <Row k="Notice commitments (HCS)" v={<Receipt href={`${HASHSCAN}/topic/${d.topics.notices}`}>{d.topics.notices}</Receipt>} />
            <Row k="Administrative agent" v={<Receipt href={`${HASHSCAN}/account/${d.operator.accountId}`}>{d.operator.accountId}</Receipt>} />
            <Row k="Credit agreement" v={<span className="mono text-xs">{f.documentRef}</span>} />
          </dl>
        </div>
        <div className="card-flat p-5">
          <h2 className="h2">Eligible institutions (Privy desks)</h2>
          <table className="grid mt-3">
            <thead>
              <tr>
                <th>Institution</th>
                <th>Eligibility</th>
                <th className="td-right">Par</th>
                <th className="td-right">mUSD</th>
              </tr>
            </thead>
            <tbody>
              {d.holders.map((h) => (
                <tr key={h.id}>
                  <td>
                    <div className="font-medium">{h.name}</div>
                    {h.wallet && <Receipt href={`${HASHSCAN}/account/${h.wallet}`}>{short(h.wallet, 8, 6)}</Receipt>}
                  </td>
                  <td>{h.eligible ? <Pill tone="ok">eligible</Pill> : <Pill tone="bad">not eligible</Pill>}</td>
                  <td className="td-right num">{h.balances ? par(h.balances.par) : "—"}</td>
                  <td className="td-right num">{h.balances ? money(h.balances.usd) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="label mt-5 mb-2">Day-1 test accounts (local keys)</h3>
          <table className="grid">
            <tbody>
              {d.legacyInstitutions.map((i) => (
                <tr key={i.evmAddress}>
                  <td>
                    {i.name} <span className="text-ink-faint">· {i.role}</span>
                  </td>
                  <td>{i.loanEligible ? <Pill tone="ok">eligible</Pill> : <Pill tone="bad">rejected</Pill>}</td>
                  <td className="td-right">
                    <Receipt href={`${HASHSCAN}/account/${i.accountId}`}>{i.accountId}</Receipt>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
