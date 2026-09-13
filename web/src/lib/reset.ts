import { privy } from "./privy-server";
import { findMember, readOrg, writeOrg } from "./org";
import { loadRfqs } from "./rfq";
import { publish } from "./hcs";
import { hostedRead, hostedWrite, withHostedLeaseWait } from "./demo/hosted-store";

/**
 * "Reset my desk" for the people iterating on the demo. The signed-in user's institution record is
 * dropped, so the next page load provisions a fresh institution (new Privy quorum and wallet, fresh
 * Hedera onboarding by the market tick). Nothing on Hedera or in Privy is deleted: old wallets and
 * receipts stay where they are. Allowed only for the email group in DESK_RESET_EMAILS, where every
 * plus-alias of a listed address counts (adrija+judge2@example.com matches adrija@example.com).
 */
export function resetAllowed(email: string | null | undefined, list = process.env.DESK_RESET_EMAILS): boolean {
  if (!email) return false;
  const normalise = (value: string) => {
    const [local, domain = ""] = value.trim().toLowerCase().split("@");
    return `${local.split("+")[0]}@${domain}`;
  };
  const allowed = (list ?? "").split(",").map((v) => v.trim()).filter(Boolean).map(normalise);
  return allowed.includes(normalise(email));
}

export async function emailOfUser(userId: string): Promise<string | null> {
  try {
    const u = (await privy().users()._get(userId)) as { linked_accounts?: { type: string; address?: string; email?: string }[] };
    for (const a of u.linked_accounts ?? []) {
      if (a.type === "email" && a.address) return a.address.toLowerCase();
      if (a.type === "google_oauth" && a.email) return a.email.toLowerCase();
    }
  } catch { /* treated as no email */ }
  return null;
}

export class ResetRefused extends Error {}

export async function resetDesk(userId: string): Promise<{ institution: string | null; cancelledRfqs: number; droppedIssuances: number }> {
  const hit = findMember(readOrg(), userId);
  // Named institutions (Meridian, Halcyon, the automated desks) are never dropped from here.
  if (hit && !hit.institution.selfService) throw new ResetRefused(`${hit.institution.name} is a named institution, not a self-service desk. Sign in with a test alias to reset a judge desk.`);
  let cancelledRfqs = 0;
  if (hit) {
    // Withdraw the desk's open RFQs so the market maker stops quoting a desk that no longer exists.
    try {
      const { rfqs } = await loadRfqs();
      for (const r of rfqs.filter((x) => x.status === "open" && x.institution === hit.institution.id).slice(0, 10)) {
        await publish({ type: "cancel", rfqId: r.rfqId, institution: hit.institution.id, by: `reset:${userId}` });
        cancelledRfqs++;
      }
    } catch { /* best effort */ }
    writeOrg((o) => { o.institutions = o.institutions.filter((i) => i.id !== hit.institution.id); });
  }
  // Drop the user's unfinished issuance so the wizard can start again; completed assets stay on the register.
  let droppedIssuances = 0;
  await withHostedLeaseWait("operator-transactions", 30_000, async (lease) => {
    type Rec = { id: string; owner: string; completedAt?: string; steps: { state: string }[] };
    const state = await hostedRead<{ records: Rec[] }>("issuance-state");
    if (!state) return;
    const keep = state.records.filter((r) => !(r.owner === userId && !r.completedAt));
    droppedIssuances = state.records.length - keep.length;
    if (!droppedIssuances) return;
    const dropped = state.records.filter((r) => !keep.includes(r));
    await hostedWrite("issuance-state", { records: keep }, lease);
    const workflow = await hostedRead<{ kind: string; id: string } | null>("operator-workflow");
    if (workflow?.kind === "issuance" && dropped.some((r) => r.id === workflow.id)) await hostedWrite("operator-workflow", null, lease);
  }).catch(() => undefined);
  return { institution: hit?.institution.id ?? null, cancelledRfqs, droppedIssuances };
}
