"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/use-me";
import { PageHeader, Receipt, HASHSCAN, par, short, Pill } from "./ui";

type Payload = {
  security: { name: string; symbol: string; isin: string; tokenId: string; evmAddress: string; decimals: number; units: string; maxSupply: string; maturity: number; startingDate: number; documentRef: string; createTx: string; raiseCapTx: string | null; configId: string; factory: string; resolver: string; type: string; regulation: string; parUnit: string };
  live: { totalSupply: string | null; maxSupply: string | null; paused: boolean | null };
  compliance: { control: string; how: string }[];
  roles: { role: string; what: string; holder?: string }[];
  mockUsd: { tokenId: string; evmAddress: string; symbol: string; decimals: number };
  engine: { address: string };
  registerSnapshot: { address: string } | null;
  topics: { rfq: string; notices: string };
  operator: { accountId: string; evmAddress: string };
  lifecycleControls: Record<string, string | number> | null;
  atsInfra: { factory: string; resolver: string; configId: string; sdk: string };
};

const txLink = (id: string) => `${HASHSCAN}/transaction/${id.replace(/^(0\.0\.\d+)@(\d+)\.(\d+)$/, "$1-$2-$3")}`;

export function Facility() {
  const api = useApi();
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api("/api/facility").then(setD).catch((e) => setErr(e.message)); }, [api]);
  if (err) return <p className="text-sm text-bad">{err}</p>;
  if (!d) return <div className="room-loading"><i /><span>Reading the security configuration…</span></div>;
  const s = d.security;
  const date = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div>
      <PageHeader title="ATS configuration" sub={<>{s.symbol} · how the tranche is issued and controlled in Asset Tokenization Studio</>} right={<Receipt href={`${HASHSCAN}/contract/${s.tokenId}`}>{s.tokenId}</Receipt>} />

      <section className="config-grid">
        <div className="card-flat p-6">
          <h2 className="h2">Security</h2>
          <dl className="config-list">
            <Row k="Name" v={s.name} />
            <Row k="Symbol · ISIN" v={`${s.symbol} · ${s.isin}`} />
            <Row k="Type" v={s.type} />
            <Row k="Regulation" v={s.regulation} />
            <Row k="Par unit" v={`${s.parUnit} (${s.decimals} decimals)`} />
            <Row k="Issued" v={<span className="num">{par(d.live.totalSupply ?? s.units)}</span>} />
            <Row k="Maximum supply" v={<span className="num">{par(d.live.maxSupply ?? s.maxSupply)}{s.raiseCapTx && <> · <Receipt href={`${HASHSCAN}/transaction/${s.raiseCapTx}`}>upsized</Receipt></>}</span>} />
            <Row k="Start · maturity" v={`${date(s.startingDate)} · ${date(s.maturity)}`} />
            <Row k="State" v={d.live.paused === null ? "—" : d.live.paused ? <Pill tone="bad">paused</Pill> : <Pill tone="ok">transfers open</Pill>} />
            <Row k="Credit agreement" v={<span className="mono text-xs">{s.documentRef}</span>} />
            <Row k="Issuance" v={<Receipt href={`${HASHSCAN}/transaction/${s.createTx}`}>{short(s.createTx, 10, 6)}</Receipt>} />
          </dl>
        </div>

        <div className="card-flat p-6">
          <h2 className="h2">Compliance controls</h2>
          <ul className="config-controls">
            {d.compliance.map((c) => <li key={c.control}><strong>{c.control}</strong><span>{c.how}</span></li>)}
          </ul>
          {d.lifecycleControls && (
            <div className="mt-4 pt-4 border-t border-line">
              <div className="label mb-2">Demonstrated on testnet</div>
              <dl className="config-list">
                {Object.entries(d.lifecycleControls).filter(([k]) => k !== "ranAt").map(([k, v]) => {
                  const text = String(v);
                  const id = text.split(" ").find((x) => /^0\.0\.\d+@|^0x[0-9a-f]{64}$/i.test(x));
                  const label = { usdFrozenTransfer: "Frozen holder, cash transfer", usdPausedTransfer: "Paused token, cash transfer", usdRestoredTransfer: "Controls restored, cash transfer", loanPausedTransfer: "Paused security, par transfer" }[k] ?? k;
                  return <Row key={k} k={label} v={<span>{text.split(" ")[0].replace(/_/g, " ").toLowerCase()}{id && <> · <Receipt href={txLink(id)}>receipt</Receipt></>}</span>} />;
                })}
              </dl>
            </div>
          )}
        </div>

        <div className="card-flat p-6">
          <h2 className="h2">Agent roles on the security</h2>
          <p className="mt-1 text-sm text-ink-muted">Granted to the administrative agent <Receipt href={`${HASHSCAN}/account/${d.operator.accountId}`}>{d.operator.accountId}</Receipt> at issuance.</p>
          <table className="grid mt-3">
            <thead><tr><th>Role</th><th>Allows</th></tr></thead>
            <tbody>{d.roles.map((r) => <tr key={r.role}><td className="mono text-xs">{r.role}</td><td className="text-sm">{r.what}</td></tr>)}</tbody>
          </table>
        </div>

        <div className="card-flat p-6">
          <h2 className="h2">Payment leg and venue</h2>
          <dl className="config-list">
            <Row k="Mock USD (HTS)" v={<Receipt href={`${HASHSCAN}/token/${d.mockUsd.tokenId}`}>{d.mockUsd.symbol} {d.mockUsd.tokenId}</Receipt>} />
            <Row k="HTS keys" v="KYC · freeze · pause · supply · wipe, held by the agent" />
            <Row k="Settlement engine" v={<Receipt href={`${HASHSCAN}/contract/${d.engine.address}`}>{short(d.engine.address, 8, 6)}</Receipt>} />
            <Row k="Engine moves par with" v="transferFrom (compliance re-checked), never forcedTransfer" />
            {d.registerSnapshot && <Row k="Register snapshot reader" v={<Receipt href={`${HASHSCAN}/contract/${d.registerSnapshot.address}`}>{short(d.registerSnapshot.address, 8, 6)}</Receipt>} />}
            <Row k="RFQ topic" v={<Receipt href={`${HASHSCAN}/topic/${d.topics.rfq}`}>{d.topics.rfq}</Receipt>} />
            <Row k="Notice commitments" v={<Receipt href={`${HASHSCAN}/topic/${d.topics.notices}`}>{d.topics.notices}</Receipt>} />
          </dl>
          <div className="mt-4 pt-4 border-t border-line">
            <div className="label mb-2">ATS infrastructure</div>
            <dl className="config-list">
              <Row k="Factory" v={d.atsInfra.factory} />
              <Row k="Business logic resolver" v={d.atsInfra.resolver} />
              <Row k="Bond configuration" v={<span className="mono text-xs">{short(d.atsInfra.configId, 10, 4)}</span>} />
              <Row k="SDK" v={d.atsInfra.sdk} />
            </dl>
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="config-row"><dt>{k}</dt><dd>{v}</dd></div>;
}
