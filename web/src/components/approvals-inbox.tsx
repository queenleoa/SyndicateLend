"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthorizationSignature } from "@privy-io/react-auth";
import { useApi } from "@/lib/use-me";
import { approvalKind, barePrivyId, canApprove, hasSigned, type ApprovalIntent, type ApprovalKind } from "@/lib/approval-notifications";
import { APPROVALS_UPDATED } from "@/lib/use-notifications";
import { HASHSCAN, PrivyMark, when, short } from "./ui";
import styles from "./institution-workspace.module.css";

export type InstitutionApprovalPayload = {
  observer?: boolean;
  institution: {
    id: string; name: string; cosigner?: "automated" | null; wallet: { id: string; address: string };
    keyQuorumId: string | null; policyId: string | null;
    /** `keys` counts the quorum's authorisation keys (co-signer, reserve); `userIds` its human members. */
    quorum: { threshold: number | null; userIds: string[]; keys: number } | null;
    /** Public half of the desk's reserve signer, when the quorum has one. */
    reserveSigner?: string | null;
    members: { email: string; role: string; privyUserId?: string }[];
  } | null;
  me: { userId: string; role: string };
  intents: ApprovalIntent[];
  setupIntents?: Record<string, string>;
  onboarding?: { ready: boolean; steps: { key: string; label: string; state: "done" | "active" | "pending"; detail?: string; needsDesk?: boolean; intentId?: string; canRetry?: boolean }[] };
  venue?: { engine?: string; loan?: string; usd?: string };
};
export const ROLE: Record<string, string> = { trader: "Trader", compliance: "Compliance officer", pm: "Portfolio manager" };
export const OPEN = new Set(["pending", "granted", "processing"]);

export function describeIntent(intent: ApprovalIntent, data: InstitutionApprovalPayload) {
  const setup = approvalKind(intent.intent_id, data.setupIntents ?? {}) === "setup" ? data.setupIntents?.[intent.intent_id] : null;
  if (setup) return { title: setup, detail: "One-time wallet setup. The institution’s quorum must authorise this transaction." };
  const tx = intent.request_details?.body?.params?.transaction;
  if (tx?.to?.toLowerCase() === data.venue?.engine?.toLowerCase() && /^0x93cdd68b[0-9a-fA-F]{64}/.test(tx?.data ?? "")) {
    const tradeId = BigInt(`0x${tx!.data!.slice(10, 74)}`).toString();
    return { title: `Approve settlement instruction #${tradeId}`, detail: "Authorise this institution’s side of the agreed trade. The counterparty approves separately." };
  }
  return { title: "Institutional transaction approval", detail: "Review the contract and transaction details before approving." };
}

/** One quorum signer as shown in the compact signature row. */
export type SignerRow = { label: string; note: string; signed: boolean; kind: "you" | "member" | "cosigner" | "reserve" | "key" };

/** Signers of an intent; without an intent, the institution's quorum as it will sign a future one. */
export function signerRows(intent: ApprovalIntent | null, data: InstitutionApprovalPayload): SignerRow[] {
  const inst = data.institution;
  const me = barePrivyId(data.me.userId);
  const reserve = (inst?.reserveSigner ?? "").replace(/\s+/g, "");
  if (!intent) {
    const rows: SignerRow[] = (inst?.members ?? []).map((m) => {
      const isMe = barePrivyId(m.privyUserId) === me;
      return { label: isMe ? "You" : ROLE[m.role] ?? m.role, note: "Signs in the browser", signed: false, kind: isMe ? "you" : "member" };
    });
    if (inst?.cosigner === "automated") rows.push({ label: "Compliance co-signer", note: "Co-signs after you", signed: false, kind: "cosigner" });
    if (reserve) rows.push({ label: "Reserve key", note: "Standby", signed: false, kind: "reserve" });
    return rows;
  }
  const members = new Map(inst?.members.map((m) => [barePrivyId(m.privyUserId), m]) ?? []);
  let keyIndex = 0;
  return (intent.authorization_details[0]?.members ?? []).map((m) => {
    const signed = m.signed_at != null;
    if (m.type === "user") {
      const isMe = barePrivyId(m.user_id) === me;
      const staff = members.get(barePrivyId(m.user_id));
      return { label: isMe ? "You" : staff ? ROLE[staff.role] ?? staff.role : "Quorum member", note: signed ? "Signed" : "Awaiting signature", signed, kind: isMe ? "you" : "member" };
    }
    const key = (m.public_key ?? "").replace(/\s+/g, "");
    const isReserve = Boolean(reserve) && (key === reserve || (!key && keyIndex === 1));
    keyIndex++;
    if (isReserve) return { label: "Reserve key", note: signed ? "Signed" : "Standby", signed, kind: "reserve" };
    if (inst?.cosigner === "automated") return { label: "Compliance co-signer", note: signed ? "Signed" : "Co-signs after you", signed, kind: "cosigner" };
    return { label: "Authorisation key", note: signed ? "Signed" : "Awaiting signature", signed, kind: "key" };
  });
}

/** Compact, horizontal signature status: "1/2" followed by one dot per quorum signer. */
export function SignerDots({ rows, threshold, muted }: { rows: SignerRow[]; threshold: number | null; muted?: boolean }) {
  const signed = rows.filter((r) => r.signed).length;
  const need = threshold ?? rows.length;
  return <div className={`${styles.signerRow} ${muted ? styles.signerMuted : ""}`} aria-label={`${signed} of ${need} signatures`}>
    <b>{signed}/{need}</b>
    <ul className={styles.dots}>{rows.map((r, i) => <li key={i} className={r.signed ? styles.dotOn : signed > 0 && r.kind === "cosigner" ? styles.dotNext : ""} title={r.note}>{r.label}</li>)}</ul>
  </div>;
}

export function useApprovalInbox() {
  const api = useApi();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const [data, setData] = useState<InstitutionApprovalPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (pending.current) return pending.current;
    pending.current = api("/api/approvals").then((value) => { setData(value); setError(null); })
      .catch((e) => setError((e as Error).message)).finally(() => { pending.current = null; });
    return pending.current;
  }, [api]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (!stopped) timer = setTimeout(poll, 10_000); };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [refresh]);

  async function authorise(id: string) {
    const result = await api(`/api/approvals/${encodeURIComponent(id)}/payload`) as { payloads: string[]; timestamp: number };
    if (!result.payloads?.length) throw new Error("Privy did not return a signing payload. Refresh and try again.");
    let lastError: Error | null = null;
    for (const b64 of result.payloads) {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const { signature } = await generateAuthorizationSignature(bytes);
      try {
        await api(`/api/approvals/${encodeURIComponent(id)}/authorize`, { method: "POST", body: JSON.stringify({ signature, timestamp: result.timestamp }) });
        return;
      } catch (error) { lastError = error as Error; if (!/signature/i.test(lastError.message)) break; }
    }
    throw lastError ?? new Error("The approval was not accepted.");
  }

  async function act(ids: string[], action: "authorize" | "reject") {
    if (busy || !data || !ids.length) return;
    // Only explicitly recorded setup intents can be approved as a batch.
    if (ids.length > 1 && ids.some((id) => approvalKind(id, data.setupIntents ?? {}) !== "setup")) {
      setError("Trade approvals must be reviewed individually."); return;
    }
    setBusy(ids.length > 1 ? "setup-batch" : ids[0]); setError(null);
    try {
      for (const id of ids) {
        const intent = data.intents.find((i) => i.intent_id === id);
        if (!intent) throw new Error("This approval is no longer in your institution’s inbox.");
        if (action === "authorize") {
          if (!canApprove(intent, data.me.userId)) throw new Error("This action no longer needs your signature. Refresh the inbox.");
          await authorise(id);
        } else await api(`/api/approvals/${encodeURIComponent(id)}/reject`, { method: "POST" });
      }
      await refresh();
      window.dispatchEvent(new Event(APPROVALS_UPDATED));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(null); }
  }

  async function syncApproved() {
    if (busy) return;
    setBusy("execution-sync"); setError(null);
    try {
      await api("/api/approvals/sync", { method: "POST" });
      await refresh();
      window.dispatchEvent(new Event(APPROVALS_UPDATED));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(null); }
  }

  async function retrySetup(step: string, intentId: string) {
    if (busy || !window.confirm("Recover this setup approval? We will restore an existing matching approval and withdraw obsolete duplicate setup requests where possible. A new transaction requires fresh quorum approvals. Completed setup and funding will not be repeated.")) return;
    setBusy(`retry-${step}`); setError(null);
    try {
      const result = await api("/api/approvals/setup/retry", { method: "POST", body: JSON.stringify({ step, intentId }) }) as { message: string };
      await refresh();
      setNotice(result.message);
      window.dispatchEvent(new Event(APPROVALS_UPDATED));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(null); }
  }

  return { data, error, notice, busy, refresh, act, syncApproved, retrySetup };
}

/** Contract, network and timing of an intent's transaction, folded away by default. */
export function IntentDetails({ intent }: { intent: ApprovalIntent }) {
  const tx = intent.request_details?.body?.params?.transaction;
  return <details className={styles.intentDetails}><summary>Transaction details</summary><dl className={styles.metadata}><div><dt>Contract</dt><dd>{tx?.to ? <a href={`${HASHSCAN}/contract/${tx.to}`} target="_blank" rel="noreferrer">{short(tx.to, 8, 6)} ↗</a> : "Unavailable"}</dd></div><div><dt>Network</dt><dd>Hedera {tx?.chain_id === 296 ? "testnet" : `chain ${tx?.chain_id ?? "unknown"}`}</dd></div><div><dt>Created</dt><dd>{when(intent.created_at)}</dd></div><div><dt>Expires</dt><dd>{when(intent.expires_at)}</dd></div><div><dt>Method selector</dt><dd>{tx?.data?.slice(0, 10) ?? "Unavailable"}</dd></div></dl></details>;
}

export function ApprovalList({ inbox, kind }: { inbox: ReturnType<typeof useApprovalInbox>; kind: ApprovalKind }) {
  const [showHistory, setShowHistory] = useState(false);
  const { data, busy, act } = inbox;
  if (!data) return null;
  const filtered = data.intents.filter((i) => approvalKind(i.intent_id, data.setupIntents ?? {}) === kind);
  const open = filtered.filter((i) => !i.superseded && OPEN.has(i.status));
  const closed = filtered.filter((i) => i.superseded || !OPEN.has(i.status));
  const actionable = open.filter((i) => canApprove(i, data.me.userId));
  return <section id={kind === "setup" ? "setup-approvals" : "trade-approvals"} className={styles.inbox}>
    <div className={styles.sectionHeader}>
      <div><h2>{kind === "setup" ? "Wallet setup approvals" : "Trade approvals"} <span className={styles.count}>{actionable.length}</span></h2><p>{actionable.length ? "Waiting for your signature" : open.length ? "Waiting for other signers or execution" : "No approvals waiting"}</p></div>
      {kind === "setup" && actionable.length > 1 && <button className={styles.primary} disabled={busy !== null} onClick={() => void act(actionable.map((i) => i.intent_id), "authorize")}>{busy === "setup-batch" ? "Signing with Privy…" : <>Sign all {actionable.length} with <PrivyMark height={20} /></>}</button>}
    </div>
    {data.institution?.cosigner === "automated" && open.length > 0 && <p className={styles.cosignerNote}>Your signature is enough: the venue’s automated compliance co-signer completes the quorum right after you approve.</p>}
    {open.length === 0 ? <div className={styles.empty}>{kind === "setup" ? "One-time wallet permissions appear here when they are ready. The agent bank is preparing them; this page refreshes by itself." : "When your institution accepts a trade and the agent grants consent, the settlement instruction appears here."}</div> : <div className={styles.intentList}>
      {open.map((intent) => {
        const desc = describeIntent(intent, data);
        const quorum = intent.authorization_details[0];
        const mine = hasSigned(intent, data.me.userId);
        const actionable = canApprove(intent, data.me.userId);
        return <article key={intent.intent_id} id={`intent-${intent.intent_id}`} className={styles.intent}>
          <div className={styles.intentMain}>
            <div className={styles.intentTop}><span className={styles.status}>{intent.status}</span><h3>{desc.title}</h3></div>
            <p>{desc.detail}</p>
            <SignerDots rows={signerRows(intent, data)} threshold={quorum?.threshold ?? null} />
            <IntentDetails intent={intent} />
          </div>
          <div className={styles.intentSide}>{["compliance", "pm"].includes(data.me.role) && intent.status === "pending" && <button className={styles.reject} disabled={busy !== null} onClick={() => void act([intent.intent_id], "reject")}>Reject</button>}<button className={styles.primary} disabled={busy !== null || !actionable} onClick={() => void act([intent.intent_id], "authorize")}>{busy === intent.intent_id ? "Signing with Privy…" : mine ? "Your approval recorded" : actionable ? <>Approve with <PrivyMark height={20} /></> : "Awaiting execution / quorum"}</button></div>
        </article>;
      })}
    </div>}
    {closed.length > 0 && <div className={styles.history}><button className={styles.textButton} onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Hide" : "Show"} {closed.length} completed or closed actions</button>{showHistory && <ul>{closed.map((intent) => <li key={intent.intent_id}><span>{describeIntent(intent, data).title}</span><b>{intent.superseded ? "Superseded" : intent.status}</b><time>{when(intent.created_at)}</time></li>)}</ul>}</div>}
  </section>;
}

export function ApprovalsInbox() {
  const inbox = useApprovalInbox();
  return <div className={styles.workspace}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Secondary exchange · Institutional authorisation</p><h1>Trade approvals</h1><p>Authorise your institution’s trades. Wallet setup lives in Institution.</p></div><Image src="/integrations/privy.png" alt="Privy" width={110} height={40} className={styles.privy} /></header>
    <div className={styles.toolbar}><Link href="/institution">Institution & wallet setup →</Link><div className={styles.buttons}><button className={styles.secondary} disabled={inbox.busy !== null} onClick={() => void inbox.syncApproved()}>{inbox.busy === "execution-sync" ? "Checking execution…" : "Check approved transactions"}</button><button className={styles.secondary} onClick={() => void inbox.refresh()}>Refresh</button></div></div>
    {inbox.error && <div role="alert" className={styles.error}>{inbox.error}</div>}
    {!inbox.data ? <p className={styles.empty}>Loading institutional approvals…</p> : inbox.data.observer ? <p className={styles.empty}>Trade approvals are available to members of an institution.</p> : <ApprovalList inbox={inbox} kind="trade" />}
  </div>;
}
