"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/use-me";
import { PageHeader, Pill, Receipt, Empty, Stat, par, when, ago } from "./ui";
import { TradeCard, type TradeView } from "./trade-lifecycle";

type Quote = { quoteId: string; institution: string; price: string; settleAt: number; expiresAt: number; consensusAt: string; sequence: number };
type Rfq = { rfqId: string; facility: string; side: "sell" | "buy"; par: string; deadline: number; institution: string; consensusAt: string; sequence: number; quotes: Quote[]; status: string; acceptedQuoteId?: string; trade?: TradeView };
type RfqPayload = { me: { institution: string; role: string }; names: Record<string, string>; topic: string; topicLink: string; rfqs: Rfq[] };
type TradesPayload = { trades: TradeView[]; events: string[] };

export function Blotter() {
  const api = useApi();
  const router = useRouter();
  const [data, setData] = useState<RfqPayload | null>(null);
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [quoting, setQuoting] = useState<string | null>(null);

  const load = useCallback(
    async (sync = false) => {
      try {
        const [r, t] = await Promise.all([api("/api/rfqs") as Promise<RfqPayload>, api(`/api/trades${sync ? "?sync=1" : ""}`) as Promise<TradesPayload>]);
        setData(r);
        setTrades(t.trades);
        setErr(null);
      } catch (e) {
        setErr((e as Error).message);
      }
    },
    [api],
  );
  useEffect(() => {
    const initial = setTimeout(() => void load(true), 0);
    const t = setInterval(() => load(true), 12_000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, [load]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setErr(null);
    try {
      await fn();
      await load(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!data) return <p className="text-sm text-ink-muted">{err ?? "Loading blotter…"}</p>;
  const canTrade = ["trader", "pm"].includes(data.me.role);
  const open = data.rfqs.filter((r) => r.status === "open");
  const live = trades.filter((t) => !["Settled", "Cancelled", "Failed"].includes(t.state ?? ""));
  const done = trades.filter((t) => ["Settled", "Cancelled", "Failed"].includes(t.state ?? ""));
  const settledPar = trades.filter((t) => t.state === "Settled").reduce((a, t) => a + Number(t.par), 0);

  return (
    <div>
      <PageHeader
        title="RFQ blotter"
        sub={
          <>
            Meridian Holdings Term Loan B 2031 · Tranche A (MHTLB-A) · every event anchored on HCS topic{" "}
            <Receipt href={data.topicLink}>{data.topic}</Receipt>
          </>
        }
        right={
          canTrade && (
            <button className="btn btn-primary" onClick={() => setShowNew((v) => !v)}>
              {showNew ? "Close" : "New RFQ"}
            </button>
          )
        }
      />
      {err && <p className="mb-4 text-sm text-bad">{err}</p>}

      <div className="rfq-explainer">
        <div className="rfq-identity"><span>YOU ARE ACTING FOR</span><strong>{data.names[data.me.institution] ?? data.me.institution}</strong><small>{data.me.role} · eligible institutional desk</small></div>
        <div className="rfq-how"><div className="active"><i>1</i><span><strong>Request</strong><small>Seller publishes par, side and deadline</small></span></div><b>→</b><div><i>2</i><span><strong>Price</strong><small>Another eligible institution responds</small></span></div><b>→</b><div><i>3</i><span><strong>Accept</strong><small>Creates immutable settlement economics</small></span></div></div>
        <div className="rfq-tape"><i /><span>HCS MARKET TAPE</span><strong>{data.topic}</strong><small>ordered and timestamped</small></div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <Stat k="Open RFQs" v={open.length} />
        <Stat k="Trades in flight" v={live.length} sub="awaiting approvals or scheduled" />
        <Stat k="Settled par" v={par(settledPar)} sub="US$ par, atomically" />
        <Stat k="Quotes received" v={data.rfqs.reduce((a, r) => a + r.quotes.length, 0)} />
      </div>

      {showNew && <NewRfq busy={busy} onSubmit={(b) => act("new", () => api("/api/rfqs", { method: "POST", body: JSON.stringify(b) })).then(() => setShowNew(false))} />}

      <section className="mt-2">
        <h2 className="h2 mb-2">Requests for quote</h2>
        {data.rfqs.length === 0 ? (
          <Empty title="No RFQs yet">A seller publishes an RFQ; eligible desks respond with a price; the seller accepts one and the instruction is created on-chain.</Empty>
        ) : (
          <div className="card-flat overflow-x-auto">
            <table className="grid">
              <thead>
                <tr>
                  <th>RFQ</th>
                  <th>Side</th>
                  <th>Desk</th>
                  <th className="td-right">Par (US$)</th>
                  <th>Deadline</th>
                  <th>Quotes</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.rfqs.map((r) => {
                  const mine = r.institution === data.me.institution;
                  const best = [...r.quotes].sort((a, b) => (r.side === "sell" ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price)))[0];
                  return (
                    <>
                      <tr key={r.rfqId}>
                        <td className="mono text-xs">{r.rfqId}</td>
                        <td>
                          <Pill tone={r.side === "sell" ? "navy" : "sky"}>{r.side === "sell" ? "Sell" : "Buy"}</Pill>
                        </td>
                        <td>{data.names[r.institution] ?? r.institution}{mine && <span className="text-ink-faint"> (you)</span>}</td>
                        <td className="td-right num">{par(r.par)}</td>
                        <td className="text-xs text-ink-muted">{when(r.deadline)}</td>
                        <td className="num">
                          {r.quotes.length}
                          {best && <span className="text-ink-muted"> · best {best.price}</span>}
                        </td>
                        <td>
                          <Pill tone={r.status === "open" ? "warn" : r.status === "accepted" ? "ok" : "bad"} live={r.status === "open"}>
                            {r.status}
                          </Pill>
                        </td>
                        <td className="td-right">
                          {r.status === "open" && canTrade && !mine && (
                            <button className="btn btn-secondary btn-sm" onClick={() => setQuoting(quoting === r.rfqId ? null : r.rfqId)}>
                              Quote
                            </button>
                          )}
                          {r.status === "open" && canTrade && mine && (
                            <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => act("cancel", () => api(`/api/rfqs/${r.rfqId}/cancel`, { method: "POST" }))}>
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                      {(r.quotes.length > 0 || quoting === r.rfqId) && (
                        <tr key={r.rfqId + "-q"}>
                          <td colSpan={8} className="bg-surface-2">
                            <div className="flex flex-wrap gap-2 items-center">
                              {r.quotes.map((q) => (
                                <div key={q.quoteId} className={`rounded-lg border px-3 py-2 text-xs ${r.acceptedQuoteId === q.quoteId ? "border-ok bg-ok-bg" : "border-line bg-surface"}`}>
                                  <div className="font-semibold text-navy-900 num">{q.price}</div>
                                  <div className="text-ink-muted">
                                    {data.names[q.institution] ?? q.institution} · settle {when(q.settleAt)} · valid {ago(q.expiresAt)}
                                  </div>
                                  {r.status === "open" && mine && canTrade && (
                                    <button className="btn btn-primary btn-sm mt-2" disabled={busy !== null} onClick={() => act("accept", () => api(`/api/rfqs/${r.rfqId}/accept`, { method: "POST", body: JSON.stringify({ quoteId: q.quoteId }) }))}>
                                      {busy === "accept" ? "Creating instruction…" : "Accept"}
                                    </button>
                                  )}
                                </div>
                              ))}
                              {quoting === r.rfqId && (
                                <QuoteForm
                                  busy={busy}
                                  onSubmit={(b) => act("quote", () => api(`/api/rfqs/${r.rfqId}/quote`, { method: "POST", body: JSON.stringify(b) })).then(() => setQuoting(null))}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="h2 mb-2">Trades</h2>
        {trades.length === 0 ? (
          <Empty title="No trades yet">Accepting a quote creates the settlement instruction and asks both desks for approval.</Empty>
        ) : (
          <div className="space-y-3">
            {[...live, ...done].map((t) => (
              <TradeCard key={t.tradeId} t={t} names={data.names} onOpenApprovals={() => router.push("/approvals")} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NewRfq({ busy, onSubmit }: { busy: string | null; onSubmit: (b: { side: string; par: string; deadlineMinutes: string }) => void }) {
  const [f, setF] = useState({ side: "sell", par: "5000000", deadlineMinutes: "120" });
  return (
    <form
      className="card p-5 mb-6 grid grid-cols-[8rem_1fr_10rem_auto] gap-3 items-end"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
    >
      <label className="text-sm">
        <span className="label">Side</span>
        <select className="input mt-1" value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}>
          <option value="sell">Sell</option>
          <option value="buy">Buy</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="label">Par amount (US$)</span>
        <input className="input mt-1 num" value={f.par} onChange={(e) => setF({ ...f, par: e.target.value })} required />
      </label>
      <label className="text-sm">
        <span className="label">Open for (minutes)</span>
        <input className="input mt-1 num" value={f.deadlineMinutes} onChange={(e) => setF({ ...f, deadlineMinutes: e.target.value })} required />
      </label>
      <button className="btn btn-primary" disabled={busy !== null}>
        {busy === "new" ? "Publishing to HCS…" : "Publish RFQ"}
      </button>
      <p className="col-span-4 text-xs text-ink-muted">Published as a consensus-timestamped message on the venue topic; visible to every onboarded desk.</p>
    </form>
  );
}

function QuoteForm({ busy, onSubmit }: { busy: string | null; onSubmit: (b: { price: string; settleInMinutes: string; validMinutes: string }) => void }) {
  const [f, setF] = useState({ price: "99.00", settleInMinutes: "5", validMinutes: "120" });
  return (
    <form
      className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 flex items-end gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
    >
      <label>
        <span className="label">Price / 100</span>
        <input className="input mt-1 num w-24" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required />
      </label>
      <label>
        <span className="label">Settle in (min)</span>
        <input className="input mt-1 num w-20" value={f.settleInMinutes} onChange={(e) => setF({ ...f, settleInMinutes: e.target.value })} required />
      </label>
      <label>
        <span className="label">Valid (min)</span>
        <input className="input mt-1 num w-20" value={f.validMinutes} onChange={(e) => setF({ ...f, validMinutes: e.target.value })} required />
      </label>
      <button className="btn btn-primary btn-sm" disabled={busy !== null}>
        {busy === "quote" ? "Publishing…" : "Send quote"}
      </button>
    </form>
  );
}
