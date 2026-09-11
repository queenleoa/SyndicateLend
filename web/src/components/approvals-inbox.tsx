"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthorizationSignature } from "@privy-io/react-auth";
import { useApi } from "@/lib/use-me";
import { PageHeader, Pill, Ring, Avatar, Empty, Receipt, HASHSCAN, when, ago, short } from "./ui";

type Member = { email: string; role: string; privyUserId?: string };
type Intent = {
  intent_id: string;
  intent_type: string;
  status: string;
  created_at: number;
  expires_at: number;
  authorization_details: { threshold: number; members: { type: string; user_id?: string; public_key?: string; signed_at: number | null }[] }[];
  request_details: { body: { method?: string; params?: { transaction?: { to?: string; data?: string; chain_id?: number; nonce?: number } } } };
  action_result?: { status_code: number; executed_at: number; response_body?: { data?: { signed_transaction?: string } } };
};
type Payload = {
  institution: { id: string; name: string; wallet: { id: string; address: string }; members: Member[] };
  me: { userId: string; role: string };
  intents: Intent[];
};

const ROLE: Record<string, string> = { trader: "Trader", compliance: "Compliance", pm: "Portfolio manager" };
const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "sky" | ""> = { pending: "warn", granted: "warn", processing: "sky", executed: "ok", failed: "bad", rejected: "bad", expired: "", dismissed: "" };

/** Human description of what the desk wallet would sign. */
function describe(it: Intent, venue: { engine?: string; loan?: string; usd?: string }) {
  const tx = it.request_details?.body?.params?.transaction;
  const to = (tx?.to ?? "").toLowerCase();
  const sel = (tx?.data ?? "").slice(0, 10);
  if (to === venue.engine?.toLowerCase()) {
    if (sel === "0x93cdd68b") {
      const tradeId = parseInt((tx?.data ?? "").slice(10, 74) || "0", 16);
      return { title: `Approve settlement instruction #${tradeId}`, detail: "Binds the desk to the exact trade economics. Settlement schedules when the counterparty desk also approves." };
    }
    return { title: "Settlement engine action", detail: sel };
  }
  if (to === venue.usd?.toLowerCase()) {
    if (sel === "0x0a754de6") return { title: "Associate desk account with mock USD", detail: "Hedera Token Service association (HIP-719). Required once before the desk can hold or receive cash." };
    if (sel === "0x095ea7b3") return { title: "Standing cash authorisation to the settlement engine", detail: "Lets the engine debit mock USD from this desk only inside an approved, scheduled settlement." };
  }
  if (to === venue.loan?.toLowerCase()) {
    if (sel === "0x095ea7b3") return { title: "Standing loan-token authorisation to the settlement engine", detail: "Lets the engine deliver this desk's loan tokens only inside an approved, scheduled settlement." };
  }
  return { title: "Sign transaction from desk wallet", detail: `${short(to)} · ${sel}` };
}

export function ApprovalsInbox() {
  const api = useApi();
  const [data, setData] = useState<Payload | null>(null);
  const [venue, setVenue] = useState<{ engine?: string; loan?: string; usd?: string }>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const { generateAuthorizationSignature } = useAuthorizationSignature();

  const load = useCallback(() => api("/api/approvals").then(setData).catch((e) => setErr(e.message)), [api]);
  useEffect(() => {
    load();
    api("/api/register").then((r) => setVenue({ engine: r.engine?.address, loan: r.facility?.evmAddress, usd: r.mockUsd?.evmAddress })).catch(() => {});
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load, api]);

  async function act(id: string, action: "authorize" | "reject") {
    setBusy(id + action);
    setErr(null);
    try {
      if (action === "authorize") {
        const { payloads, timestamp } = (await api(`/api/approvals/${id}/payload`)) as { payloads: string[]; timestamp: number };
        let lastErr: Error | null = null;
        for (const b64 of payloads) {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const { signature } = await generateAuthorizationSignature(bytes);
          try {
            await api(`/api/approvals/${id}/authorize`, { method: "POST", body: JSON.stringify({ signature, timestamp }) });
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e as Error;
            if (!/signature/i.test(lastErr.message)) break;
          }
        }
        if (lastErr) throw lastErr;
      } else {
        await api(`/api/approvals/${id}/${action}`, { method: "POST" });
      }
      await load();
      // Let the venue pick up executed intents (broadcast to Hedera) without waiting for the poll.
      api("/api/trades?sync=1").catch(() => {});
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (err && !data) return <p className="text-sm text-bad">{err}</p>;
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;

  const bare = (id?: string) => (id ?? "").replace(/^did:privy:/, "");
  const memberByUser = new Map(data.institution.members.map((m) => [bare(m.privyUserId), m]));
  const iSigned = (it: Intent) => it.authorization_details.some((a) => a.members.some((m) => m.type === "user" && bare(m.user_id) === bare(data.me.userId) && m.signed_at));
  const canReject = ["compliance", "pm"].includes(data.me.role);
  const open = data.intents.filter((i) => ["pending", "granted", "processing"].includes(i.status));
  const closed = data.intents.filter((i) => !["pending", "granted", "processing"].includes(i.status));

  return (
    <div>
      <PageHeader
        title="Approvals"
        sub={
          <>
            {data.institution.name} desk wallet <Receipt href={`${HASHSCAN}/account/${data.institution.wallet.address}`}>{short(data.institution.wallet.address, 8, 6)}</Receipt> is owned by a{" "}
            <strong>2-of-3 quorum</strong> of named people. You are the <strong>{ROLE[data.me.role] ?? data.me.role}</strong>.
          </>
        }
        right={
          <button className="btn btn-secondary" onClick={load}>
            Refresh
          </button>
        }
      />
      {err && <p className="mb-4 text-sm text-bad">{err}</p>}

      <div className="panel-dark p-4 mb-6 grid grid-cols-[auto_1fr] gap-4 items-center">
        <div className="flex -space-x-1.5">
          {data.institution.members.map((m) => (
            <Avatar key={m.email} name={m.email} />
          ))}
        </div>
        <div className="text-sm leading-relaxed">
          <span className="text-[#b9dff2]">How an approval works.</span> A trader proposes an action. Each approver signs it in their own browser with a key bound to their login session; the platform relays the signature but never holds a desk key. When two of the three have signed, Privy signs the transaction inside its enclave and the venue broadcasts it to Hedera. The wallet policy only permits the settlement venue&apos;s contracts.
        </div>
      </div>

      {open.length === 0 ? (
        <Empty title="Nothing waiting for the desk">Accepting a quote on the blotter, or onboarding steps from administration, create the next approval.</Empty>
      ) : (
        <div className="space-y-3">
          {open.map((it) => (
            <IntentCard key={it.intent_id} it={it} venue={venue} memberByUser={memberByUser} bare={bare} iSigned={iSigned(it)} busy={busy} canReject={canReject} onAct={act} />
          ))}
        </div>
      )}

      <div className="mt-8 flex items-center justify-between">
        <h2 className="h2">History</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Hide" : `Show ${closed.length}`}
        </button>
      </div>
      {showDone && (
        <div className="mt-2 card-flat overflow-x-auto">
          <table className="grid">
            <thead>
              <tr>
                <th>Action</th>
                <th>Status</th>
                <th>Signed by</th>
                <th>Created</th>
                <th>Executed</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((it) => {
                const d = describe(it, venue);
                const q = it.authorization_details[0];
                return (
                  <tr key={it.intent_id}>
                    <td>{d.title}</td>
                    <td>
                      <Pill tone={STATUS_TONE[it.status]}>{it.status}</Pill>
                    </td>
                    <td className="text-xs">
                      {q?.members
                        .filter((m) => m.signed_at)
                        .map((m) => memberByUser.get(bare(m.user_id))?.role ?? "key")
                        .join(", ")}
                    </td>
                    <td className="text-xs text-ink-muted">{when(it.created_at)}</td>
                    <td className="text-xs text-ink-muted">{it.action_result ? when(it.action_result.executed_at) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IntentCard({ it, venue, memberByUser, bare, iSigned, busy, canReject, onAct }: {
  it: Intent;
  venue: { engine?: string; loan?: string; usd?: string };
  memberByUser: Map<string, Member>;
  bare: (s?: string) => string;
  iSigned: boolean;
  busy: string | null;
  canReject: boolean;
  onAct: (id: string, a: "authorize" | "reject") => void;
}) {
  const d = describe(it, venue);
  const q = it.authorization_details[0];
  const signed = q?.members.filter((m) => m.signed_at).length ?? 0;
  const tx = it.request_details?.body?.params?.transaction;
  const signing = busy === it.intent_id + "authorize";
  return (
    <div className="card p-5 grid grid-cols-[auto_1fr_auto] gap-5">
      <Ring value={signed} max={q?.threshold ?? 2} tone={signed >= (q?.threshold ?? 2) ? "ok" : ""} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Pill tone={STATUS_TONE[it.status]} live={it.status === "pending"}>{it.status}</Pill>
          <span className="h2">{d.title}</span>
        </div>
        <p className="mt-1 text-sm text-ink-muted">{d.detail}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {q?.members.map((m, i) => {
            const mem = m.type === "user" ? memberByUser.get(bare(m.user_id)) : undefined;
            const label = mem ? `${ROLE[mem.role] ?? mem.role} · ${mem.email}` : m.type === "user" ? bare(m.user_id) : "authorization key";
            return (
              <span key={i} className={`pill ${m.signed_at ? "pill-ok" : ""}`}>
                {label}
                {m.signed_at ? ` · signed ${ago(m.signed_at)}` : " · waiting"}
              </span>
            );
          })}
        </div>
        <div className="mt-3 text-[11px] text-ink-faint mono">
          to {short(tx?.to ?? "", 8, 6)} · chain {tx?.chain_id} · nonce {tx?.nonce ?? "—"} · proposed {when(it.created_at)} · expires {ago(it.expires_at)}
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <button className="btn btn-primary" disabled={busy !== null || iSigned} onClick={() => onAct(it.intent_id, "authorize")}>
          {iSigned ? "You have signed" : signing ? "Signing in browser…" : "Approve with my key"}
        </button>
        {canReject && (
          <button className="btn btn-danger btn-sm" disabled={busy !== null} onClick={() => onAct(it.intent_id, "reject")}>
            Reject
          </button>
        )}
      </div>
    </div>
  );
}
