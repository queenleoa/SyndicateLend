"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/use-me";
import { FACILITY_TYPES, unallocated, validateIssuanceTerms, type IssuanceStatus, type IssuanceTerms, type IssuanceView } from "@/lib/issuance-spec";
import styles from "./issuance-wizard.module.css";

const INITIAL: IssuanceTerms = { name: "Meridian Holdings Term Loan B 2031 — Tranche C", symbol: "MHTLB-C", facilityType: "Term Loan B", principal: "30000000", maturityDate: "2031-06-30", documentRef: "ipfs://synthetic-credit-agreement-hash", rateBps: 725, allocations: [], pauser: true, freezeManager: true, controller: false };
const money = (v: string | bigint | number) => `$${Number(v).toLocaleString("en-US")}`;
const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-6)}`;
const STEPS = ["Loan terms", "Syndicate", "Lender controls", "Review & issue", "On-chain register"];
const RESULT = 4;

/** Suggested split: your own institution leads, then the syndicate lenders; the agent bank keeps any remainder. */
function suggestedSplit(principal: string, wallets: string[]): { wallet: string; par: string }[] {
  const total = BigInt(/^\d+$/.test(principal) ? principal : "0");
  const weights = [30, 25, 20, 15, 10];
  const chosen = wallets.slice(0, weights.length);
  const sum = weights.slice(0, chosen.length).reduce((a, b) => a + b, 0);
  return chosen.map((wallet, i) => ({ wallet, par: ((total * BigInt(weights[i])) / BigInt(sum) / 1_000_000n * 1_000_000n).toString() }));
}

export function IssuanceWizard() {
  const api = useApi();
  const [terms, setTerms] = useState<IssuanceTerms>(INITIAL);
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<IssuanceStatus | null>(null);
  const [record, setRecord] = useState<IssuanceView | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [allocationInput, setAllocationInput] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const seeded = useRef(false);

  const load = useCallback(async () => {
    const result = await api("/api/issuance", { cache: "no-store" }) as IssuanceStatus;
    setStatus(result);
    if (result.record && !result.record.completedAt) { setRecord(result.record); setTerms(result.record.terms); setStep(RESULT); }
    return result;
  }, [api]);

  useEffect(() => {
    const timer = setTimeout(() => { void load().catch((e: Error) => setError(e.message)); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // Seed a suggested syndicate once the lender list is known.
  useEffect(() => {
    if (seeded.current || !status?.lenders.length) return;
    seeded.current = true;
    const preferred = [...status.lenders].sort((a, b) => rank(a.kind, a.mine) - rank(b.kind, b.mine));
    const split = suggestedSplit(INITIAL.principal, preferred.map((l) => l.wallet));
    setAllocationInput(Object.fromEntries(split.map((a) => [a.wallet.toLowerCase(), a.par])));
  }, [status]);

  useEffect(() => {
    if (!running || !record || record.completedAt) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (inFlight.current) { timer = setTimeout(tick, 1000); return; }
      inFlight.current = true;
      let pause = 2000;
      try {
        const result = await api(`/api/issuance/${record.id}/advance`, { method: "POST" }) as { record: IssuanceView };
        if (stopped) return;
        setWaiting(null);
        setRecord(result.record);
        if (result.record.completedAt || result.record.steps.some((s) => s.state === "failed" || s.state === "review")) { setRunning(false); return; }
      } catch (e) {
        if (stopped) return;
        // 423: the agent bank's signing account is busy (market tick). Keep going; the server already waited.
        if (busyError(e)) { setWaiting((e as Error).message); pause = 3000; }
        else { setError((e as Error).message); setRunning(false); }
      } finally { inFlight.current = false; }
      if (!stopped) timer = setTimeout(tick, pause);
    };
    void tick();
    return () => { stopped = true; clearTimeout(timer); };
    // Each run resumes its immutable issuance id. Response changes must not start parallel POSTs.
  }, [api, record?.id, running]); // eslint-disable-line react-hooks/exhaustive-deps

  const allocations = useMemo(() => Object.entries(allocationInput).filter(([, v]) => /^[1-9]\d*$/.test(v.replace(/[,\s]/g, ""))).map(([wallet, par]) => ({ wallet, par: par.replace(/[,\s]/g, "") })), [allocationInput]);
  const composed = useMemo(() => ({ ...terms, allocations }), [terms, allocations]);
  const remainder = (() => { try { return unallocated({ principal: composed.principal, allocations }); } catch { return 0n; } })();

  const next = () => {
    try { setTerms(validateIssuanceTerms(composed, Date.now(), status?.takenSymbols ?? [])); setError(null); setStep((s) => s + 1); }
    catch (e) { setError((e as Error).message); }
  };

  const issue = async () => {
    if (!confirmed || busy) return;
    setBusy(true); setError(null);
    try {
      // The server waits up to 30 s for the agent bank's lock; keep trying a little longer if it is still busy.
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await api("/api/issuance", { method: "POST", body: JSON.stringify({ terms: composed, confirmed: true }) }) as { record: IssuanceView };
          setWaiting(null); setRecord(result.record); setStep(RESULT); setRunning(true);
          break;
        } catch (e) {
          if (!busyError(e) || attempt >= 3) throw e;
          setWaiting((e as Error).message);
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }
    } catch (e) {
      setWaiting(null);
      setError((e as Error).message);
      await load().catch(() => undefined);
    } finally { setBusy(false); }
  };

  const field = (key: keyof IssuanceTerms, value: string | boolean | number) => setTerms((t) => ({ ...t, [key]: value }));
  const halted = record?.steps.some((s) => s.state === "failed" || s.state === "review");
  const liveEnabled = Boolean(status?.enabled && status.remaining > 0);
  const confirmedSteps = record?.steps.filter((s) => s.state === "confirmed").length ?? 0;
  const lenders = status?.lenders ?? [];

  return (
    <div className={styles.wizard}>
      <header className={styles.heading}>
        <div><h1>Issue a new asset</h1><p>An asset is one facility or tranche of the syndicated loan under the credit agreement. Each lender’s par is a token balance on it.</p></div>
        <div className={styles.sponsor}><Image src="/integrations/hedera.svg" alt="Hedera" width={108} height={30} /><span>Asset Tokenization Studio</span></div>
      </header>

      <ol className={styles.steps} aria-label="Issuance progress">
        {STEPS.map((label, i) => <li key={label} className={i === step ? styles.current : i < step ? styles.done : ""} aria-current={i === step ? "step" : undefined}><span>{i < step ? "✓" : i + 1}</span>{label}</li>)}
      </ol>

      {error && <div className={styles.error} role="alert">{error}<button onClick={() => { setError(null); void load().catch((e: Error) => setError(e.message)); }}>Refresh saved status</button></div>}
      {waiting && !error && <div className={styles.waiting} role="status">{waiting}</div>}

      {step < RESULT ? <div className={styles.layout}>
        <section className={styles.panel}>
          {step === 0 && <>
            <h2>Define the asset</h2>
            <div className={styles.fields}>
              <label className={styles.name}>Asset name<input value={terms.name} onChange={(e) => field("name", e.target.value)} maxLength={100} autoComplete="off" /></label>
              <label>Facility type<select value={terms.facilityType} onChange={(e) => field("facilityType", e.target.value)}>{FACILITY_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
              <label>Token symbol<input value={terms.symbol} onChange={(e) => field("symbol", e.target.value.toUpperCase())} maxLength={12} autoComplete="off" /></label>
              <label>Principal (USD)<input value={terms.principal} onChange={(e) => field("principal", e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" autoComplete="off" /></label>
              <label>Maturity date<input type="date" value={terms.maturityDate} onChange={(e) => field("maturityDate", e.target.value)} /></label>
              <label>All-in rate (basis points)<input value={terms.rateBps} onChange={(e) => field("rateBps", Number(e.target.value.replace(/[^0-9]/g, "")))} inputMode="numeric" autoComplete="off" /><span>{(terms.rateBps / 100).toFixed(2)}% a year. Private: only a salted hash of the rate notice goes on-chain.</span></label>
              <label>Currency<div className={styles.fixed}>USD · 1 token = $1 par</div></label>
              <label className={styles.full}>Credit agreement reference<input value={terms.documentRef} onChange={(e) => field("documentRef", e.target.value)} maxLength={180} autoComplete="off" /></label>
            </div>
          </>}

          {step === 1 && <>
            <h2>Allocate the syndicate</h2>
            <p className={styles.intro}>Each lender is allowlisted, KYC-checked and issued its par on-chain. The agent bank keeps any remainder.</p>
            <div className={styles.allocationHead}><button className={styles.secondary} onClick={() => setAllocationInput(Object.fromEntries(suggestedSplit(terms.principal, [...lenders].sort((a, b) => rank(a.kind, a.mine) - rank(b.kind, b.mine)).map((l) => l.wallet)).map((a) => [a.wallet.toLowerCase(), a.par])))}>Suggested split</button><button className={styles.secondary} onClick={() => setAllocationInput({})}>Clear</button></div>
            <div className={styles.lenders}>
              {[...lenders].sort((a, b) => rank(a.kind, a.mine) - rank(b.kind, b.mine)).map((l) => <label key={l.wallet}><span><strong>{l.name}{l.mine && " · your institution"}</strong><span>{l.kind === "automated" ? "Automated demo institution" : l.kind === "anchor" ? "Syndicate lender" : "Institutional lender"} · {short(l.wallet)}</span></span><input inputMode="numeric" placeholder="0" value={allocationInput[l.wallet.toLowerCase()] ?? ""} onChange={(e) => setAllocationInput((v) => ({ ...v, [l.wallet.toLowerCase()]: e.target.value.replace(/[^0-9]/g, "") }))} /></label>)}
              {lenders.length === 0 && <p className={styles.note}>No lenders on the register yet.</p>}
            </div>
            <div className={remainder < 0n ? styles.remainderBad : styles.remainder}><span>{remainder < 0n ? "Over-allocated by" : "Unallocated, kept by the agent bank"}</span><strong>{money((remainder < 0n ? -remainder : remainder).toString())}</strong></div>
          </>}

          {step === 2 && <>
            <h2>Control who can hold the asset</h2>
            <div className={styles.required}><strong>✓ Approved lender list</strong><span>Only allowlisted accounts can receive positions.</span><strong>✓ Valid KYC at execution</strong><span>The agent grants each holder a time-bound KYC record.</span></div>
            <h3>Agent bank permissions</h3>
            <div className={styles.controls}>
              <label><input type="checkbox" checked={terms.pauser} onChange={(e) => field("pauser", e.target.checked)} /><span><strong>Pause all transfers</strong><span>During a review or amendment.</span></span></label>
              <label><input type="checkbox" checked={terms.freezeManager} onChange={(e) => field("freezeManager", e.target.checked)} /><span><strong>Freeze a holder</strong><span>Restrict one account without pausing the asset.</span></span></label>
              <label><input type="checkbox" checked={terms.controller} onChange={(e) => field("controller", e.target.checked)} /><span><strong>Controller transfers</strong><span>Permit forced transfers by the agent.</span></span></label>
            </div>
          </>}

          {step === 3 && <>
            <h2>Review and issue</h2>
            <dl className={styles.review}>
              <div><dt>Asset</dt><dd>{terms.name} · {terms.symbol}</dd></div>
              <div><dt>Facility</dt><dd>{terms.facilityType}</dd></div>
              <div><dt>Principal</dt><dd>{money(terms.principal)}</dd></div>
              <div><dt>Syndicate</dt><dd>{allocations.length ? allocations.map((a) => `${lenders.find((l) => l.wallet.toLowerCase() === a.wallet)?.name ?? short(a.wallet)} ${money(a.par)}`).join(" · ") : "No allocations; the agent bank holds the principal"}</dd></div>
              <div><dt>Kept by agent bank</dt><dd>{money(remainder.toString())}</dd></div>
              <div><dt>Maturity</dt><dd>{terms.maturityDate}</dd></div>
              <div><dt>All-in rate</dt><dd>{(terms.rateBps / 100).toFixed(2)}% · committed as a salted hash on HCS</dd></div>
              <div><dt>Agent rights</dt><dd>{[terms.pauser && "Pause", terms.freezeManager && "Freeze", terms.controller && "Controller transfers"].filter(Boolean).join(" · ") || "None"}</dd></div>
              <div><dt>On-chain steps</dt><dd>{5 + allocations.length * 3 + (remainder > 0n ? 1 : 0)} Hedera transactions + 1 HCS commitment</dd></div>
            </dl>
            <label className={styles.confirm}><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /><span>I authorise the agent bank to submit these Hedera testnet transactions.</span></label>
            {status && !liveEnabled && <p className={styles.unavailable}>{status.reason ?? "The funded issuance limit has been reached. The register and its assets remain available."}</p>}
          </>}

          <div className={styles.actions}>
            {step > 0 ? <button className={styles.secondary} onClick={() => { setStep((s) => s - 1); setError(null); }} disabled={busy}>Back</button> : <Link href="/register" className={styles.secondary}>Open the register</Link>}
            {step < 3 ? <button className={styles.primary} onClick={next}>{["Allocate the syndicate", "Set lender controls", "Review"][step]}<span aria-hidden>→</span></button> : <button className={styles.primary} onClick={() => void issue()} disabled={!confirmed || !liveEnabled || busy}>{busy ? "Saving…" : "Issue on Hedera"}<span aria-hidden>→</span></button>}
          </div>
        </section>

        <aside className={styles.summary}>
          <span className={styles.eyebrow}>AGENT BANK · NEW ASSET</span>
          <h2>{terms.symbol || "New asset"}</h2>
          <div className={styles.amount}>{/^\d+$/.test(terms.principal) ? money(terms.principal) : "—"}</div>
          <p>{terms.facilityType} · {allocations.length} lender{allocations.length === 1 ? "" : "s"}</p>
          <div className={styles.flow}><span>Credit agreement</span><b aria-hidden>↓</b><span>ATS loan token</span><b aria-hidden>↓</b><span>Syndicate register</span><b aria-hidden>↓</b><span>Rate notice committed</span></div>
        </aside>
      </div> : record && <div className={styles.layout}>
        <section className={styles.panel}>
          <div className={styles.resultHeading}><div><h2>{record.completedAt ? "Issued. The asset is on the register." : halted ? "Issuance needs review" : "Issuing on Hedera"}</h2><p className={styles.intro}>{record.terms.name}</p></div><span className={record.completedAt ? styles.complete : styles.inProgress}>{record.completedAt ? "Confirmed" : running ? `${confirmedSteps} / ${record.steps.length} confirmed` : "Saved"}</span></div>
          <ol className={styles.transactions} aria-live="polite">
            {record.steps.map((s, i) => <li key={s.key} className={s.state === "confirmed" ? styles.confirmedTx : ""}><span className={styles.txNumber}>{s.state === "confirmed" ? "✓" : i + 1}</span><div><strong>{s.label}</strong><span>{s.state === "queued" ? "Waiting" : s.state === "pending" ? "Submitted · awaiting confirmation" : s.state === "confirmed" ? (s.op === "notice" ? "Committed on Hedera HCS" : "Confirmed on Hedera testnet") : s.state === "failed" ? "Reverted · host review required" : "Receipt unresolved · host review required"}</span></div>{s.hash && s.op !== "notice" && <a href={`https://hashscan.io/testnet/transaction/${s.hash}`} target="_blank" rel="noreferrer">Receipt ↗</a>}</li>)}
          </ol>
          {record.completedAt ? <>
            <div className={styles.balances}><div><span>Issued principal</span><strong>{money(record.totalSupply!)}</strong></div><div><span>Held by the agent bank</span><strong>{money(record.agentBalance!)}</strong></div></div>
            <div className={styles.actions}><a className={styles.secondary} href={`https://hashscan.io/testnet/contract/${record.tokenId ?? record.securityAddress}`} target="_blank" rel="noreferrer">View token on HashScan ↗</a><Link href={`/register?asset=${encodeURIComponent(record.terms.symbol)}`} className={styles.primary}>View it in the loan register →</Link></div>
          </> : <div className={styles.actions}><span className={styles.note}>{running ? "You can leave this page. Confirmed steps are saved." : "Saved steps are reused when you resume."}</span>{!halted && <button className={styles.primary} disabled={running || !status?.enabled} onClick={() => { setError(null); setRunning(true); }}>{running ? "Issuing…" : "Resume issuance"}</button>}</div>}
        </section>
        <aside className={styles.summary}><span className={styles.eyebrow}>YOUR NEW ASSET</span><h2>{record.terms.symbol}</h2><div className={styles.amount}>{money(record.terms.principal)}</div><p>{record.terms.facilityType} · 1 token = $1 par</p><dl className={styles.receiptDetails}><div><dt>Synthetic ISIN</dt><dd>{record.isin}</dd></div><div><dt>Agent bank account</dt><dd><a href={`https://hashscan.io/testnet/account/${record.agent}`} target="_blank" rel="noreferrer">{short(record.agent)} ↗</a></dd></div><div><dt>Token</dt><dd>{record.securityAddress ? <a href={`https://hashscan.io/testnet/contract/${record.tokenId ?? record.securityAddress}`} target="_blank" rel="noreferrer">{record.tokenId ?? short(record.securityAddress)} ↗</a> : "Awaiting ATS creation"}</dd></div></dl>{record.completedAt && <Link href="/issue" onClick={() => { setRecord(null); setStep(0); setConfirmed(false); setTerms((t) => ({ ...t, symbol: "", name: "" })); }}>Issue another asset →</Link>}</aside>
      </div>}
    </div>
  );
}

const busyError = (e: unknown) => (e as { status?: number })?.status === 423;

function rank(kind: string, mine = false) {
  return mine ? -1 : kind === "anchor" ? 0 : kind === "desk" ? 1 : kind === "self-service" ? 2 : 3;
}
