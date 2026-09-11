"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/use-me";
import { PageHeader, Stat, Receipt, HASHSCAN, money, par, short, Empty, Pill } from "./ui";
import { TradeCard, type TradeView } from "./trade-lifecycle";

type Payload = {
  institution: { id: string; name: string; wallet: { id: string; address: string } | null; hedera: Record<string, unknown> & { accountId?: string; allocatedPar?: string; usdFunded?: string } };
  balances: { hbar: string; par: string; usd: string; loanAllowance: string; usdAllowance: string; hashscan: string } | null;
  trades: TradeView[];
  names: Record<string, string>;
};

export function Portfolio() {
  const api = useApi();
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api("/api/portfolio").then(setD).catch((e) => setErr(e.message));
  }, [api]);
  if (err) return <p className="text-sm text-bad">{err}</p>;
  if (!d) return <p className="text-sm text-ink-muted">Loading…</p>;
  const b = d.balances;
  const bought = d.trades.filter((t) => t.state === "Settled" && t.buyer.institution === d.institution.id).reduce((a, t) => a + Number(t.par), 0);
  const sold = d.trades.filter((t) => t.state === "Settled" && t.seller.institution === d.institution.id).reduce((a, t) => a + Number(t.par), 0);
  const standing = b && BigInt(b.loanAllowance) > 0n && BigInt(b.usdAllowance) > 0n;
  return (
    <div>
      <PageHeader
        title="Portfolio"
        sub={
          d.institution.wallet ? (
            <>
              {d.institution.name} · desk wallet <Receipt href={`${HASHSCAN}/account/${d.institution.wallet.address}`}>{short(d.institution.wallet.address, 8, 6)}</Receipt>
              {d.institution.hedera?.accountId && <> · Hedera account {d.institution.hedera.accountId}</>}
            </>
          ) : (
            "No desk wallet provisioned"
          )
        }
      />
      {b ? (
        <div className="grid grid-cols-4 gap-3">
          <Stat k="MHTLB-A position (US$ par)" v={par(b.par)} sub="on the ATS register" />
          <Stat k="Mock USD" v={`$${money(b.usd)}`} sub="HTS permissioned cash" />
          <Stat k="HBAR" v={(Number(b.hbar) / 1e18).toFixed(2)} sub="network fees" />
          <Stat
            k="Venue authorisation"
            v={standing ? <Pill tone="ok">standing</Pill> : <Pill tone="warn">not set</Pill>}
            sub={standing ? "engine may deliver only inside approved settlements" : "desk quorum must approve the standing authorisations"}
          />
        </div>
      ) : (
        <Empty title="No balances">Provision a desk wallet in administration first.</Empty>
      )}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Stat k="Bought (settled par)" v={par(bought)} />
        <Stat k="Sold (settled par)" v={par(sold)} />
      </div>
      <section className="mt-8">
        <h2 className="h2 mb-2">Desk trades</h2>
        {d.trades.length === 0 ? (
          <Empty title="No trades for this desk yet" />
        ) : (
          <div className="space-y-3">
            {d.trades.map((t) => (
              <TradeCard key={t.tradeId} t={t} names={d.names} />
            ))}
          </div>
        )}
      </section>
      {d.trades.some((t) => t.state === "Settled") && (
        <p className="mt-6 text-xs text-ink-faint">Settled trades moved loan tokens and mock USD in the same transaction, executed by the Hedera Schedule Service at the agreed time. Receipts above.</p>
      )}
    </div>
  );
}
