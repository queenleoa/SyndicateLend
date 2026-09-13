"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/use-me";
import { PageHeader, Stat, Receipt, HASHSCAN, money, par, short, Empty, Pill } from "./ui";
import { TradeCard, type TradeView } from "./trade-lifecycle";

type Payload = {
  observer?: boolean;
  institution: null | { id: string; name: string; wallet: { id: string; address: string } | null; hedera: Record<string, unknown> & { accountId?: string; allocatedPar?: string; usdFunded?: string } };
  balances: { hbar: string; par: string; usd: string; loanAllowance: string; usdAllowance: string; hashscan: string } | null;
  trades: TradeView[];
  names: Record<string, string>;
  positions: { symbol: string; name: string; facilityType: string; par: string | null; tradeable: boolean }[];
  accruals: { facilityId: string; periodId: number; days: string; commitment: string; amountUnits: string | null; paid: { accountId: string; amountUnits: string } | null; skipped: string | null; payoutLink: string | null }[];
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
  if (d.observer || !d.institution) {
    return (
      <div>
        <PageHeader title="Portfolio" sub="Positions and cash of the institution you belong to." />
        <Empty title="No desk yet">Sign in again once your institution has been created.</Empty>
      </div>
    );
  }
  const inst = d.institution;
  const b = d.balances;
  const bought = d.trades.filter((t) => t.state === "Settled" && t.buyer.institution === inst.id).reduce((a, t) => a + Number(t.par), 0);
  const sold = d.trades.filter((t) => t.state === "Settled" && t.seller.institution === inst.id).reduce((a, t) => a + Number(t.par), 0);
  const standing = b && BigInt(b.loanAllowance) > 0n && BigInt(b.usdAllowance) > 0n;
  return (
    <div>
      <PageHeader
        title="My positions"
        sub={
          inst.wallet ? (
            <>
              {inst.name} · desk wallet <Receipt href={`${HASHSCAN}/account/${inst.wallet.address}`}>{short(inst.wallet.address, 8, 6)}</Receipt>
              {inst.hedera?.accountId && <> · Hedera account {inst.hedera.accountId}</>}
            </>
          ) : (
            "No desk wallet provisioned"
          )
        }
      />
      {b ? (
        <div className="grid grid-cols-4 gap-4">
          <Stat k="Loan positions (US$ par)" v={par(d.positions.reduce((sum, p) => sum + Number(p.par ?? 0), 0))} sub={`${d.positions.filter((p) => Number(p.par ?? 0) > 0).length} of ${d.positions.length} assets on the register`} />
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
      <div className="grid grid-cols-2 gap-4 mt-4">
        <Stat k="Bought (settled par)" v={par(bought)} />
        <Stat k="Sold (settled par)" v={par(sold)} />
      </div>
      <section className="mt-10">
        <h2 className="h2 mb-3">Positions by asset</h2>
        <div className="card-flat overflow-x-auto">
          <table className="grid">
            <thead><tr><th>Asset</th><th>Facility</th><th className="td-right">Par (US$)</th><th>Secondary market</th></tr></thead>
            <tbody>
              {d.positions.map((p) => (
                <tr key={p.symbol}>
                  <td><strong>{p.symbol}</strong> · {p.name}</td>
                  <td>{p.facilityType}</td>
                  <td className="td-right num">{p.par === null ? "unavailable" : par(p.par)}</td>
                  <td>{p.tradeable ? <Pill tone="ok">RFQ transfers</Pill> : <Pill>register only</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="h2 mb-3">Interest accruals</h2>
        {d.accruals.length === 0 ? (
          <Empty title="No accrual period computed yet">The arranger publishes a rate-notice commitment and the confidential workflow computes each holder&apos;s share.</Empty>
        ) : (
          <div className="card-flat overflow-x-auto">
            <table className="grid">
              <thead><tr><th>Period</th><th>Days</th><th className="td-right">Accrued (mUSD)</th><th>Payout</th><th>Commitment</th></tr></thead>
              <tbody>
                {d.accruals.map((a) => (
                  <tr key={`${a.facilityId}-${a.periodId}`}>
                    <td>{a.facilityId} · period {a.periodId}</td>
                    <td className="num">{a.days}</td>
                    <td className="td-right num">{a.amountUnits ? money(a.amountUnits) : "not in snapshot"}</td>
                    <td>{a.paid ? <span className="flex items-center gap-2"><Pill tone="ok">paid {money(a.paid.amountUnits)}</Pill>{a.payoutLink && <Receipt href={a.payoutLink}>HTS</Receipt>}</span> : a.skipped ? <Pill tone="warn">{a.skipped}</Pill> : a.amountUnits && a.amountUnits !== "0" ? <Pill tone="warn">not paid yet</Pill> : <Pill>nothing due</Pill>}</td>
                    <td className="mono text-xs" title={a.commitment}>{short(a.commitment, 10, 6)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="h2 mb-3">My trades</h2>
        {d.trades.length === 0 ? (
          <Empty title="No trades for this desk yet" />
        ) : (
          <div className="space-y-4">
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
