import { privy } from "./privy-server";
import { readOrg, writeOrg, type Institution, type Role } from "./org";
import { provisionInstitution } from "./provision";
import { fund, eligibility, allocate, proposeDeskStep, syncOnboarding, fundUsd, onboardingOf, type HederaOnboarding } from "./onboarding";

/**
 * Self-service desks. A new sign-in gets its own institution: the email is the trader and the
 * `+compliance` and `+pm` aliases of the same inbox are the compliance officer and portfolio manager,
 * so one person controls a real 2-of-3 quorum (one-time codes for the aliases land in the same inbox).
 * The operator side of Hedera onboarding then runs step by step from the market tick.
 */
const FUND_HBAR = "10";
const OPENING_PAR = "10000000"; // US$10m par
const OPENING_USD = "15000000"; // US$15m mock USD

async function emailOf(userId: string): Promise<string | null> {
  const u = (await privy().users()._get(userId)) as { linked_accounts?: { type: string; address?: string; email?: string }[] };
  for (const a of u.linked_accounts ?? []) {
    if (a.type === "email" && a.address) return a.address.toLowerCase();
    if (a.type === "google_oauth" && a.email) return a.email.toLowerCase();
  }
  return null;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "desk";
}
function titleCase(s: string) {
  return s.split(/[._\-+]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/** Members for a self-service desk: trader = email, compliance and PM = plus-addressed aliases. */
export function aliasesFor(email: string): { email: string; role: Role }[] {
  const [local, domain] = email.split("@");
  const [base, tag] = local.split("+");
  const prefix = tag ? `${base}+${tag}-` : `${base}+`;
  return [
    { email, role: "trader" },
    { email: `${prefix}compliance@${domain}`, role: "compliance" },
    { email: `${prefix}pm@${domain}`, role: "pm" },
  ];
}

/** Create the institution for a first-time sign-in. */
export async function provisionForUser(userId: string): Promise<Institution> {
  const email = await emailOf(userId);
  if (!email) throw new Error("this login has no email address; sign in with email or Google");
  const [local] = email.split("@");
  const base = local.split("+")[0];
  let members = aliasesFor(email);
  const taken = new Set(readOrg().institutions.flatMap((i) => i.members.map((m) => m.email.toLowerCase())));
  if (members.slice(1).some((m) => taken.has(m.email))) {
    const suffix = Math.random().toString(36).slice(2, 6);
    members = aliasesFor(`${base}+${suffix}@${email.split("@")[1]}`).map((m, i) => (i === 0 ? { ...m, email } : m));
  }
  const name = `${titleCase(base)} Capital`;
  const id = `${slug(base)}-${Math.random().toString(36).slice(2, 6)}`;
  await provisionInstitution({ id, name, members });
  writeOrg((o) => {
    const i = o.institutions.find((x) => x.id === id)!;
    i.selfService = true;
    i.createdAt = Date.now();
    i.members = i.members.map((m) => (m.role === "trader" ? { ...m, privyUserId: userId } : m));
  });
  return readOrg().institutions.find((x) => x.id === id)!;
}

/** Run the next operator step of a desk's Hedera onboarding. Returns what it did, or null when idle. */
export async function advanceOnboarding(id: string): Promise<string | null> {
  const inst = readOrg().institutions.find((i) => i.id === id);
  if (!inst?.wallet) return null;
  const h = onboardingOf(inst);
  if (!h.accountId) { const r = await fund(id, FUND_HBAR); return `funded ${r.accountId}`; }
  if (!h.eligibilityTx) { await eligibility(id, true); return "eligible on the register"; }
  if (!h.allocateTx) { await allocate(id, OPENING_PAR); return `allocated ${OPENING_PAR} par`; }
  // Desk-signed steps: propose whichever is missing (a desk provisioned by hand may have some already).
  const missing = (["usdAssociate", "allowLoan", "allowUsd"] as const).filter((s) => !h[s] || (!h[s]!.txHash && ["rejected", "expired"].includes(h[s]!.status ?? "")));
  if (missing.length) {
    for (const s of missing) await proposeDeskStep(id, s);
    return `proposed ${missing.join(", ")}`;
  }
  const done = await syncOnboarding(id);
  const h2 = onboardingOf(readOrg().institutions.find((i) => i.id === id)!);
  // A desk step whose transaction reverted is proposed again (new intent, new signatures).
  for (const step of ["usdAssociate", "allowLoan", "allowUsd"] as const) {
    const st = h2[step];
    if (!st) continue;
    const reverted = st.txHash && st.error === "reverted";
    const unbroadcastable = !st.txHash && st.status === "executed" && st.error && /nonce|already|replacement|underpriced/i.test(st.error);
    if (reverted || unbroadcastable) { await proposeDeskStep(id, step); return `re-proposed ${step} (${reverted ? "reverted" : "could not be broadcast"})`; }
  }
  if (h2.usdAssociate?.txHash && !h2.usdAssociate.error && !h2.usdKycTx) { await fundUsd(id, OPENING_USD); return `KYC granted and ${OPENING_USD} mock USD funded`; }
  return done.length ? done.join("; ") : null;
}

const ok = (s?: { txHash?: string; error?: string }) => Boolean(s?.txHash && !s.error);
export function onboardingReady(inst: Institution): boolean {
  const h = onboardingOf(inst);
  return Boolean(h.accountId && h.eligibilityTx && h.allocateTx && ok(h.usdAssociate) && ok(h.allowLoan) && ok(h.allowUsd) && h.usdKycTx);
}

export type OnboardingStep = { key: string; label: string; state: "done" | "active" | "pending"; detail?: string; needsDesk?: boolean; intentId?: string };

/** Human view of where a desk is in onboarding. */
export function onboardingSummary(inst: Institution): { ready: boolean; steps: OnboardingStep[] } {
  const h: HederaOnboarding = onboardingOf(inst);
  const desk = (s: HederaOnboarding["usdAssociate"]) => (s?.txHash && !s.error ? "done" : "pending") as "done" | "pending";
  const sig = (s: HederaOnboarding["usdAssociate"]) => (s ? (s.error === "reverted" ? "reverted on-chain, being proposed again" : `${s.signatures ?? 0}/${s.threshold ?? 2} signatures${s.status && s.status !== "pending" ? ` · ${s.status}` : ""}`) : "not proposed yet");
  const steps: OnboardingStep[] = [
    { key: "wallet", label: "Desk wallet created in Privy", state: "done", detail: inst.wallet?.address },
    { key: "account", label: "Hedera account funded", state: h.accountId ? "done" : "pending", detail: h.accountId },
    { key: "eligible", label: "Whitelisted and KYC-checked on the ATS register", state: h.eligibilityTx ? "done" : "pending" },
    { key: "par", label: `Opening position of ${Number(OPENING_PAR).toLocaleString("en-US")} par allocated`, state: h.allocateTx ? "done" : "pending" },
    { key: "usdAssociate", label: "Associate the desk with mock USD (desk-signed)", state: desk(h.usdAssociate), detail: sig(h.usdAssociate), needsDesk: true, intentId: h.usdAssociate?.intentId },
    { key: "allowLoan", label: "Standing loan-token authorisation to the engine (desk-signed)", state: desk(h.allowLoan), detail: sig(h.allowLoan), needsDesk: true, intentId: h.allowLoan?.intentId },
    { key: "allowUsd", label: "Standing cash authorisation to the engine (desk-signed)", state: desk(h.allowUsd), detail: sig(h.allowUsd), needsDesk: true, intentId: h.allowUsd?.intentId },
    { key: "cash", label: `${Number(OPENING_USD).toLocaleString("en-US")} mock USD funded`, state: h.usdKycTx ? "done" : "pending" },
  ];
  const first = steps.findIndex((s) => s.state === "pending");
  if (first >= 0) steps[first].state = "active";
  return { ready: onboardingReady(inst), steps };
}
