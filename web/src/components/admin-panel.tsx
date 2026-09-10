"use client";

import { useEffect, useState } from "react";
import { useApi, useMe } from "@/lib/use-me";

type Inst = {
  id: string;
  name: string;
  members: { email: string; role: string; privyUserId?: string }[];
  keyQuorumId?: string;
  wallet?: { id: string; address: string };
  policyId?: string;
};

export function AdminPanel() {
  const api = useApi();
  const { me } = useMe();
  const [insts, setInsts] = useState<Inst[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", trader: "", compliance: "", pm: "" });

  const load = () => api("/api/admin/institutions").then((j) => setInsts(j.institutions)).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function provision(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/institutions", {
        method: "POST",
        body: JSON.stringify({
          id: form.id,
          name: form.name,
          members: [
            { email: form.trader, role: "trader" },
            { email: form.compliance, role: "compliance" },
            { email: form.pm, role: "pm" },
          ],
        }),
      });
      setForm({ id: "", name: "", trader: "", compliance: "", pm: "" });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-lg font-semibold text-navy-800">Administration</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Signed in as <span className="font-mono">{me?.userId ?? "…"}</span>
        {me?.institution ? ` · ${me.institution.name} · ${me.roleLabel}` : " · not attached to an institution"}
      </p>

      <section className="card mt-6 p-5">
        <h2 className="font-semibold text-navy-800">Onboard an institution</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Creates three Privy users, a 2-of-3 key quorum of those users, a desk wallet owned by the quorum, and a policy that
          restricts the wallet to the settlement venue contracts on Hedera testnet.
        </p>
        <form onSubmit={provision} className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="label">Identifier</span>
            <input className="input mt-1" required value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="meridian" />
          </label>
          <label className="text-sm">
            <span className="label">Institution name</span>
            <input className="input mt-1" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Meridian Credit Partners" />
          </label>
          {(["trader", "compliance", "pm"] as const).map((r) => (
            <label key={r} className="text-sm">
              <span className="label">{r === "pm" ? "Portfolio manager" : r === "compliance" ? "Compliance officer" : "Trader"} email</span>
              <input className="input mt-1" type="email" required value={form[r]} onChange={(e) => setForm({ ...form, [r]: e.target.value })} />
            </label>
          ))}
          <div className="col-span-2 flex items-center gap-3">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Provisioning in Privy…" : "Provision institution"}
            </button>
            {err && <span className="text-sm text-bad">{err}</span>}
          </div>
        </form>
      </section>

      <section className="card mt-6 p-5">
        <h2 className="font-semibold text-navy-800">Institutions</h2>
        {!insts ? (
          <p className="mt-2 text-sm text-ink-muted">Loading…</p>
        ) : insts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">None yet.</p>
        ) : (
          <table className="grid mt-3">
            <thead>
              <tr>
                <th>Institution</th>
                <th>Desk members</th>
                <th>Desk wallet</th>
                <th>Quorum / policy</th>
              </tr>
            </thead>
            <tbody>
              {insts.map((i) => (
                <tr key={i.id}>
                  <td>
                    <div className="font-medium">{i.name}</div>
                    <div className="text-xs text-ink-muted">{i.id}</div>
                  </td>
                  <td>
                    {i.members.map((m) => (
                      <div key={m.email} className="text-xs">
                        <span className="pill pill-sky mr-1">{m.role}</span>
                        {m.email}
                      </div>
                    ))}
                  </td>
                  <td className="font-mono text-xs break-all">{i.wallet?.address ?? "—"}</td>
                  <td className="font-mono text-xs">
                    <div>2 of 3 · {i.keyQuorumId}</div>
                    <div>{i.policyId}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
