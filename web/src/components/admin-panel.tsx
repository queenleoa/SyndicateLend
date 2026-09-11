"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi, useMe } from "@/lib/use-me";
import { PageHeader, Pill, Receipt, HASHSCAN, short, par, money, Steps, type StepState } from "./ui";

type Step = { intentId: string; status?: string; signatures?: number; threshold?: number; txHash?: string; error?: string };
type Hedera = { accountId?: string; fundTx?: string; eligibilityTx?: string; allocateTx?: string; allocatedPar?: string; usdAssociate?: Step; usdKycTx?: string; usdFundTx?: string; usdFunded?: string; allowLoan?: Step; allowUsd?: Step };
type Inst = { id: string; name: string; members: { email: string; role: string; privyUserId?: string }[]; keyQuorumId?: string; wallet?: { id: string; address: string }; policyId?: string; hedera?: Hedera; loanEligible?: boolean };
type Balances = { hbar: string; par: string; usd: string; loanAllowance: string; usdAllowance: string };

export function AdminPanel() {
  const api = useApi();
  const { me } = useMe();
  const [insts, setInsts] = useState<Inst[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", trader: "", compliance: "", pm: "" });

  const load = useCallback(() => api("/api/admin/institutions").then((j) => setInsts(j.institutions)).catch((e) => setErr(e.message)), [api]);
  useEffect(() => {
    load();
  }, [load]);

  async function provision(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/institutions", {
        method: "POST",
        body: JSON.stringify({ id: form.id, name: form.name, members: [{ email: form.trader, role: "trader" }, { email: form.compliance, role: "compliance" }, { email: form.pm, role: "pm" }] }),
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
    <div>
      <PageHeader title="Administration" sub={<>Platform operator · signed in as <span className="mono">{me?.userId ?? "…"}</span></>} />
      {err && <p className="mb-4 text-sm text-bad">{err}</p>}

      <section className="card p-5">
        <h2 className="h2">Onboard an institution</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Creates three Privy users, a 2-of-3 key quorum of those users, a policy limited to the settlement venue on Hedera testnet, and a desk wallet owned by the quorum and governed by the policy.
        </p>
        <form onSubmit={provision} className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="label">Identifier</span>
            <input className="input mt-1" required value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} placeholder="northgate" />
          </label>
          <label className="text-sm">
            <span className="label">Institution name</span>
            <input className="input mt-1" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Northgate Insurance" />
          </label>
          {(["trader", "compliance", "pm"] as const).map((r) => (
            <label key={r} className="text-sm">
              <span className="label">{r === "pm" ? "Portfolio manager" : r === "compliance" ? "Compliance officer" : "Trader"} email</span>
              <input className="input mt-1" type="email" required value={form[r]} onChange={(e) => setForm({ ...form, [r]: e.target.value })} />
            </label>
          ))}
          <div className="col-span-2">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "Provisioning in Privy…" : "Provision institution"}
            </button>
          </div>
        </form>
      </section>

      <h2 className="h2 mt-8 mb-2">Institutions</h2>
      {!insts ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="space-y-4">
          {insts.map((i) => (
            <InstitutionCard key={i.id} i={i} onChange={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function InstitutionCard({ i, onChange }: { i: Inst; onChange: () => void }) {
  const api = useApi();
  const [bal, setBal] = useState<Balances | null>(null);
  const [h, setH] = useState<Hedera>(i.hedera ?? {});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [parIn, setParIn] = useState("100000000");
  const [usdIn, setUsdIn] = useState("10000000");

  const refresh = useCallback(
    (sync = false) =>
      api(`/api/admin/institutions/${i.id}/hedera${sync ? "?sync=1" : ""}`)
        .then((j) => {
          setBal(j.balances);
          setH(j.hedera);
        })
        .catch((e) => setErr(e.message)),
    [api, i.id],
  );
  useEffect(() => {
    if (i.wallet) refresh(true);
  }, [refresh, i.wallet]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setErr(null);
    try {
      await api(`/api/admin/institutions/${i.id}/hedera`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
      await refresh(true);
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const stepState = (s?: Step): StepState => (!s ? "pending" : s.txHash ? "done" : s.error || ["rejected", "expired", "failed"].includes(s.status ?? "") ? "failed" : "active");
  const deskStep = (s?: Step) => (!s ? "not proposed" : s.txHash ? "on-chain" : `${s.signatures ?? 0}/${s.threshold ?? 2} approvals · ${s.status}`);
  const steps = [
    { title: "Fund", sub: h.accountId ? `account ${h.accountId}` : "HBAR for fees", state: (h.fundTx ? "done" : "pending") as StepState },
    { title: "Eligibility", sub: "whitelist + KYC on tranche", state: (i.loanEligible ? "done" : "pending") as StepState },
    { title: "Associate mUSD", sub: deskStep(h.usdAssociate), state: stepState(h.usdAssociate) },
    { title: "Cash", sub: h.usdKycTx ? `KYC · ${h.usdFunded ?? 0} mUSD` : "KYC + opening balance", state: (h.usdKycTx ? "done" : "pending") as StepState },
    { title: "Standing auth", sub: `${deskStep(h.allowLoan)} / ${deskStep(h.allowUsd)}`, state: h.allowLoan?.txHash && h.allowUsd?.txHash ? "done" : h.allowLoan || h.allowUsd ? stepState(h.allowLoan ?? h.allowUsd) : "pending" },
  ];

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h2">{i.name}</span>
            <span className="text-xs text-ink-faint mono">{i.id}</span>
            {i.loanEligible ? <Pill tone="ok">eligible</Pill> : <Pill>not eligible</Pill>}
          </div>
          <div className="mt-1 text-xs text-ink-muted flex flex-wrap gap-x-3 gap-y-1">
            {i.members.map((m) => (
              <span key={m.email}>
                <span className="font-semibold">{m.role}</span> {m.email}
              </span>
            ))}
          </div>
          <div className="mt-1 text-xs text-ink-muted mono">
            quorum {i.keyQuorumId} · policy {i.policyId} · wallet{" "}
            {i.wallet && <Receipt href={`${HASHSCAN}/account/${i.wallet.address}`}>{short(i.wallet.address, 8, 6)}</Receipt>}
          </div>
        </div>
        {bal && (
          <div className="text-right text-xs text-ink-muted num">
            <div>
              <span className="font-semibold text-ink">{par(bal.par)}</span> par
            </div>
            <div>
              <span className="font-semibold text-ink">${money(bal.usd)}</span> mUSD
            </div>
            <div>{(Number(bal.hbar) / 1e18).toFixed(2)} HBAR</div>
          </div>
        )}
      </div>

      {i.wallet && (
        <>
          <div className="mt-4">
            <Steps items={steps} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => act("fund", { hbar: "25" })}>
              {busy === "fund" ? "Funding…" : "Fund 25 HBAR"}
            </button>
            <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => act(i.loanEligible ? "revoke" : "eligibility")}>
              {busy === "eligibility" || busy === "revoke" ? "Updating…" : i.loanEligible ? "Revoke eligibility" : "Grant eligibility"}
            </button>
            <span className="inline-flex items-center gap-1">
              <input className="input num w-36 !py-1 text-xs" value={parIn} onChange={(e) => setParIn(e.target.value)} />
              <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => act("allocate", { par: parIn })}>
                {busy === "allocate" ? "Issuing…" : "Allocate par"}
              </button>
            </span>
            <button className="btn btn-secondary btn-sm" disabled={busy !== null || !!h.usdAssociate} onClick={() => act("usdAssociate")}>
              Propose mUSD association (desk)
            </button>
            <span className="inline-flex items-center gap-1">
              <input className="input num w-32 !py-1 text-xs" value={usdIn} onChange={(e) => setUsdIn(e.target.value)} />
              <button className="btn btn-secondary btn-sm" disabled={busy !== null || !h.usdAssociate?.txHash} onClick={() => act("fundUsd", { usd: usdIn })}>
                {busy === "fundUsd" ? "KYC + funding…" : "KYC + fund mUSD"}
              </button>
            </span>
            <button className="btn btn-secondary btn-sm" disabled={busy !== null || !!h.allowLoan} onClick={() => act("allowLoan")}>
              Propose loan authorisation (desk)
            </button>
            <button className="btn btn-secondary btn-sm" disabled={busy !== null || !!h.allowUsd} onClick={() => act("allowUsd")}>
              Propose cash authorisation (desk)
            </button>
            <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => refresh(true)}>
              Sync desk steps
            </button>
          </div>
          {err && <p className="mt-2 text-sm text-bad">{err}</p>}
          <p className="mt-2 text-[11px] text-ink-faint">
            Operator steps run immediately with the administrative-agent key. Desk steps become approvals in the institution&apos;s inbox; once two members sign, Privy signs and the venue broadcasts.
          </p>
        </>
      )}
    </div>
  );
}
