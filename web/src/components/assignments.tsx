"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/use-me";
import { PageHeader, Pill, Receipt, HASHSCAN, Empty, money, par, when, ago } from "./ui";
import { TradeCard, type TradeView } from "./trade-lifecycle";
import { colourFor } from "@/lib/agent";

type Payload = { me: { userId: string; isAgent: boolean; institution: string | null }; names: Record<string, string>; autoConsentDelayS: number; trades: TradeView[] };

/** Registry view: assignments between institutions, the arranger's consent, and their settlement. */
export function Assignments() {
  const api = useApi();
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const load = useCallback(() => api("/api/assignments").then((v) => { setD(v); setNow(Date.now()); }).catch((e) => setErr(e.message)), [api]);
  useEffect(() => { load(); const t = setInterval(load, 8_000); return () => clearInterval(t); }, [load]);
  if (err && !d) return <p className="text-sm text-bad">{err}</p>;
  if (!d) return <div className="room-loading"><i /><span>Loading assignments…</span></div>;

  const colour = (id: string) => colourFor(Object.keys(d.names).indexOf(id));
  const pending = d.trades.filter((t) => t.consent?.status === "pending");
  const inFlight = d.trades.filter((t) => t.consent?.status !== "pending" && !["Settled", "Cancelled", "Failed"].includes(t.state ?? ""));
  const done = d.trades.filter((t) => ["Settled", "Cancelled", "Failed"].includes(t.state ?? ""));

  async function consent(id: string) {
    setBusy(id);
    setErr(null);
    try { await api(`/api/assignments/${id}/consent`, { method: "POST" }); await load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }

  return (
    <div>
      <PageHeader title="Assignments" sub={<>Trades agreed between two institutions are assignments of a loan interest. As arranger I consent to each one; only then does the settlement instruction go on-chain, both desks approve it, and Hedera settles par against cash in one transaction. {d.me.isAgent ? "You are signed in as the arranger." : "The arranger automation consents on the arranger's behalf."}</>} />
      {err && <p className="mb-4 text-sm text-bad">{err}</p>}

      <section className="mb-10">
        <h2 className="h2 mb-3">Awaiting the arranger&apos;s consent</h2>
        {pending.length === 0 ? (
          <Empty title="Nothing awaiting consent">When a desk accepts a quote on the secondary exchange, the assignment appears here first.</Empty>
        ) : (
          <div className="space-y-4">
            {pending.map((t) => {
              const secondsLeft = Math.max(0, Math.round(d.autoConsentDelayS - (now - (t.consent?.requestedAt ?? t.createdAt)) / 1000));
              return (
                <div key={t.tradeId} className="card p-6 assignment-card">
                  <div className="assignment-parties">
                    <Party name={d.names[t.seller.institution] ?? t.seller.institution} role="Assignor (sells)" colour={colour(t.seller.institution)} />
                    <div className="assignment-arrow"><strong>{par(t.par)} par</strong><span>@ {t.price} · ${money(t.cash)} mUSD</span><b>→</b></div>
                    <Party name={d.names[t.buyer.institution] ?? t.buyer.institution} role="Assignee (buys)" colour={colour(t.buyer.institution)} right />
                  </div>
                  <div className="assignment-foot">
                    <div className="text-sm text-ink-muted">Agreed {ago(t.createdAt)} · settles {when(t.settleAt)} · RFQ <span className="mono">{t.rfqId}</span></div>
                    <div className="flex items-center gap-3">
                      <Pill tone="warn" live>{secondsLeft > 0 ? `automation consents in ${secondsLeft}s` : "automation consenting"}</Pill>
                      {d.me.isAgent && <button className="btn btn-primary" disabled={busy !== null} onClick={() => consent(t.tradeId)}>{busy === t.tradeId ? "Consenting…" : "Consent to transfer"}</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="h2 mb-3">Consented, in settlement</h2>
        {inFlight.length === 0 ? <Empty title="No assignment in settlement" /> : <div className="space-y-4">{inFlight.map((t) => <TradeCard key={t.tradeId} t={t} names={d.names} />)}</div>}
      </section>

      <section>
        <h2 className="h2 mb-3">Settled and closed</h2>
        {done.length === 0 ? <Empty title="No settled assignment yet" /> : <div className="space-y-4">{done.map((t) => <TradeCard key={t.tradeId} t={t} names={d.names} />)}</div>}
      </section>
      <p className="mt-6 text-xs text-ink-faint">Every consent, instruction, approval and settlement is a message on the venue&apos;s HCS topic and a transaction on the engine; receipts link to <a className="underline" href={`${HASHSCAN}/topic/0.0.10459663`} target="_blank" rel="noreferrer">HashScan</a>. <Receipt href={`${HASHSCAN}/contract/0x593D401cF80FAE8422a5aA113075cD2F464c297F`}>engine</Receipt></p>
    </div>
  );
}

function Party({ name, role, colour, right }: { name: string; role: string; colour: string; right?: boolean }) {
  return <div className={`assignment-party ${right ? "right" : ""}`}><i style={{ background: colour }}>{name.slice(0, 1)}</i><div><small>{role}</small><strong>{name}</strong></div></div>;
}
