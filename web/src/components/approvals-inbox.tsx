"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuthorizationSignature } from "@privy-io/react-auth";
import { useApi } from "@/lib/use-me";

type Member = { email: string; role: string; privyUserId?: string };
type Intent = {
  intent_id: string;
  intent_type: string;
  status: string;
  created_at: number;
  expires_at: number;
  created_by_display_name?: string;
  authorization_details: { threshold: number; members: { type: string; user_id?: string; public_key?: string; signed_at: number | null }[] }[];
  request_details: { body: { method?: string; params?: { transaction?: { to?: string; data?: string; chain_id?: number } } } };
  action_result?: { status_code: number; executed_at: number };
};
type Payload = {
  institution: { id: string; name: string; wallet: { id: string; address: string }; members: Member[] };
  me: { userId: string; role: string };
  intents: Intent[];
};

const STATUS_PILL: Record<string, string> = { pending: "pill-warn", granted: "pill-warn", processing: "pill-sky", executed: "pill-ok", failed: "pill-bad", rejected: "pill-bad", expired: "", dismissed: "" };

function ProposeForm({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const [tradeId, setTradeId] = useState("1");
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/approvals/propose-settlement", { method: "POST", body: JSON.stringify({ tradeId, instructionHash: hash }) });
      setHash("");
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="card mt-6 p-5">
      <h2 className="font-semibold text-navy-800">Propose a desk approval</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Raises an intent for the desk wallet to sign <span className="font-mono">SettlementEngine.approve(tradeId, instructionHash)</span>. Nothing is signed
        until two of the three desk members authorise it.
      </p>
      <div className="mt-3 grid grid-cols-[8rem_1fr_auto] gap-3 items-end">
        <label className="text-sm">
          <span className="label">Trade id</span>
          <input className="input mt-1 num" value={tradeId} onChange={(e) => setTradeId(e.target.value)} required />
        </label>
        <label className="text-sm">
          <span className="label">Instruction hash</span>
          <input className="input mt-1 font-mono" value={hash} onChange={(e) => setHash(e.target.value)} placeholder="0x…" pattern="0x[0-9a-fA-F]{64}" required />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Proposing…" : "Propose"}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-bad">{err}</p>}
    </form>
  );
}

export function ApprovalsInbox() {
  const api = useApi();
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { generateAuthorizationSignature } = useAuthorizationSignature();

  const load = useCallback(() => api("/api/approvals").then(setData).catch((e) => setErr(e.message)), [api]);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function act(id: string, action: "authorize" | "reject") {
    setBusy(id + action);
    setErr(null);
    try {
      if (action === "authorize") {
        // Sign the intent's canonical request bytes in the browser with this member's Privy key.
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
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (err && !data) return <p className="text-sm text-bad">{err}</p>;
  if (!data) return <p className="text-sm text-ink-muted">Loading…</p>;

  // Intent members carry bare user ids; sessions and the directory use the did:privy: form.
  const bare = (id?: string) => (id ?? "").replace(/^did:privy:/, "");
  const memberByUser = new Map(data.institution.members.map((m) => [bare(m.privyUserId), m]));
  const iSigned = (it: Intent) => it.authorization_details.some((a) => a.members.some((m) => m.type === "user" && bare(m.user_id) === bare(data.me.userId) && m.signed_at));
  const canApprove = ["trader", "compliance", "pm"].includes(data.me.role);
  const canReject = ["compliance", "pm"].includes(data.me.role);

  return (
    <div className="max-w-5xl">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold text-navy-800">Approvals</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {data.institution.name} desk wallet <span className="font-mono">{data.institution.wallet.address}</span> · owned by a 2-of-3 quorum of the desk. You are the{" "}
            <strong>{data.me.role === "pm" ? "portfolio manager" : data.me.role === "compliance" ? "compliance officer" : "trader"}</strong>.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={load}>
          Refresh
        </button>
      </div>
      {err && <p className="mt-3 text-sm text-bad">{err}</p>}

      {["trader", "pm"].includes(data.me.role) && <ProposeForm onDone={load} />}

      {data.intents.length === 0 ? (
        <div className="card mt-6 p-6 text-sm text-ink-muted">No desk actions yet. Accepting a quote on the blotter creates the first one.</div>
      ) : (
        <div className="mt-6 space-y-3">
          {data.intents.map((it) => {
            const tx = it.request_details?.body?.params?.transaction;
            const quorum = it.authorization_details[0];
            const signed = quorum?.members.filter((m) => m.signed_at).length ?? 0;
            const open = it.status === "pending" || it.status === "granted";
            return (
              <div key={it.intent_id} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`pill ${STATUS_PILL[it.status] ?? ""}`}>{it.status}</span>
                      <span className="text-sm font-medium text-navy-800">Sign transaction from desk wallet</span>
                    </div>
                    <div className="mt-2 text-xs text-ink-muted font-mono break-all">
                      to {tx?.to} · chain {tx?.chain_id} · data {tx?.data?.slice(0, 10)}… · created {new Date(it.created_at).toLocaleString()} · expires{" "}
                      {new Date(it.expires_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="label">Authorisations</div>
                    <div className="num text-lg font-semibold text-navy-800">
                      {signed} / {quorum?.threshold ?? "?"}
                    </div>
                  </div>
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {quorum?.members.map((m, i) => {
                    const mem = m.type === "user" ? memberByUser.get(bare(m.user_id)) : undefined;
                    return (
                      <li key={i} className={`pill ${m.signed_at ? "pill-ok" : ""}`}>
                        {mem ? `${mem.role} · ${mem.email}` : m.type === "user" ? m.user_id : "authorization key"}
                        {m.signed_at ? " · approved" : " · waiting"}
                      </li>
                    );
                  })}
                </ul>
                {open && (
                  <div className="mt-4 flex items-center gap-2">
                    {canApprove && (
                      <button className="btn btn-primary" disabled={busy !== null || iSigned(it)} onClick={() => act(it.intent_id, "authorize")}>
                        {iSigned(it) ? "You have approved" : busy === it.intent_id + "authorize" ? "Signing…" : "Approve with my key"}
                      </button>
                    )}
                    {canReject && (
                      <button className="btn btn-danger" disabled={busy !== null} onClick={() => act(it.intent_id, "reject")}>
                        Reject
                      </button>
                    )}
                    <span className="text-xs text-ink-muted">Your approval is a P-256 signature from a key bound to your login session; the platform never holds it.</span>
                  </div>
                )}
                {it.action_result && (
                  <div className="mt-3 text-xs text-ink-muted">
                    Executed {new Date(it.action_result.executed_at).toLocaleString()} · status {it.action_result.status_code}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
