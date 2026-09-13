import { readOrg } from "./org";
import { syncOnboarding } from "./onboarding";
import { syncTrades } from "./rfq";
import { trades } from "./trades";
import { flush, flushStrict, hydrateStrict, redisBacked } from "./store";
import { HostedDemoError, hostedRead, withHostedLeaseWait } from "./demo/hosted-store";

/** Broadcast only already-executed Privy intents; never authorises or proposes an action. */
export async function syncInstitutionApprovals(institutionId: string, intentId?: string) {
  const sync = async () => {
    const institution = readOrg().institutions.find((candidate) => candidate.id === institutionId);
    if (!institution?.wallet || institution.automated) throw new Error("A human institution wallet is required.");
    const onboarding = await syncOnboarding(institutionId);
    // A single matching trade per request keeps the hosted operation bounded.
    const trade = trades.read().trades.find((candidate) => !candidate.demo &&
      !["Settled", "Cancelled"].includes(candidate.state ?? "") &&
      [candidate.approvals.seller, candidate.approvals.buyer].some((approval) =>
        approval.institution === institutionId && (!intentId || approval.intentId === intentId)));
    const settlement = trade ? await syncTrades((candidate) => candidate.tradeId === trade.tradeId && !candidate.demo) : [];
    return { onboarding, settlement };
  };
  return withInstitutionApprovalWrite(institutionId, sync);
}

const writeRegistry = globalThis as typeof globalThis & { syndicatelendApprovalWrites?: Set<string> };
const activeWrites = writeRegistry.syndicatelendApprovalWrites ??= new Set<string>();

/** Setup recovery and execution must not replace/broadcast the same recorded intent concurrently. */
export async function withInstitutionApprovalWrite<T>(institutionId: string, work: () => Promise<T>): Promise<T> {
  if (activeWrites.has(institutionId)) throw new HostedDemoError(409, "Your institution's approved transactions are already being checked. Try again shortly.");
  activeWrites.add(institutionId);
  try {
  if (redisBacked || process.env.HOSTED_REGISTRY_DEMO_ENABLED === "true") {
    return await withHostedLeaseWait("operator-transactions", 20_000, async (lease) => {
      if (await hostedRead("operator-workflow")) throw new HostedDemoError(409, "The agent is completing an issuance or settlement demonstration. Your signatures are preserved; check approved transactions again when that workflow finishes.");
      await hydrateStrict();
      await lease.assertOwned();
      const result = await work();
      await flushStrict();
      return result;
    });
  }
  const result = await work();
  await flush();
  return result;
  } finally { activeWrites.delete(institutionId); }
}
