import { randomUUID } from "node:crypto";
import { readOrg, type Institution } from "../org";
import { trades, type TradeRecord } from "../trades";
import { deskBalances } from "../onboarding";
import { onboardingReady, onboardingSummary } from "../self-service";
import { acceptQuote, type Quote, type Rfq } from "../rfq";
import { publish } from "../hcs";
import { automatedDesk, automatedDesks } from "../automated-desk";

/**
 * The agent-bank transfer-request demo. Two automated institutions (Bishopsgate sells, Aldgate buys) agree a
 * US$1m assignment of the first tranche on the HCS market: RFQ, quote, acceptance. The assignment then waits
 * for the agent bank's consent in Loan Registry → Transfer requests. After consent both institutions sign
 * their approval with their own automated quorums, the engine schedules the settlement on Hedera, and the
 * network executes it. No human desk wallet is ever signed by the server.
 */
const DEMO_PAR = "1000000";
const DEMO_PRICE = "99.00";
const SETTLE_S = 4 * 60;

export function transferDemoParties(): { seller: Institution; buyer: Institution } | null {
  const seller = automatedDesks().find((i) => i.demoCounterparty) ?? null;
  const buyer = automatedDesk();
  return seller?.wallet && buyer?.wallet ? { seller, buyer } : null;
}

export function activeTransferDemo(): TradeRecord | null {
  return trades.read().trades.filter((t) => t.demo?.kind === "transfer-demo" && !["Settled", "Cancelled", "Failed"].includes(t.state ?? "") && t.expiresAt > Date.now() / 1000).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export function transferDemoStatus() {
  const parties = transferDemoParties();
  const describe = (i: Institution | undefined) => {
    if (!i) return { id: null, name: null, ready: false, step: "Not provisioned" };
    const summary = onboardingSummary(i);
    return { id: i.id, name: i.name, ready: summary.ready, step: summary.ready ? "Ready" : summary.steps.find((s) => s.state === "active")?.label ?? "Onboarding" };
  };
  const seller = describe(parties?.seller);
  const buyer = describe(parties?.buyer);
  const active = activeTransferDemo();
  return { configured: Boolean(parties) && (process.env.AUTOMATED_DESK_KEYS ?? "").split(",").filter((v) => v.trim()).length >= 2, ready: seller.ready && buyer.ready, seller, buyer, activeRfqId: active?.rfqId ?? null, par: DEMO_PAR, price: DEMO_PRICE };
}

/** Publish the RFQ, quote and acceptance between the two automated desks. Returns the pending assignment. */
export async function createTransferRequest(userId: string): Promise<TradeRecord> {
  const existing = activeTransferDemo();
  if (existing) return existing;
  const parties = transferDemoParties();
  if (!parties) throw new Error("The two automated demo institutions are not provisioned yet.");
  const { seller, buyer } = parties;
  for (const inst of [seller, buyer]) if (!onboardingReady(inst)) throw new Error(`${inst.name} is still being onboarded on Hedera: ${onboardingSummary(inst).steps.find((s) => s.state === "active")?.label ?? "waiting"}. Try again in a minute.`);
  const [s, b] = await Promise.all([deskBalances(seller.wallet!.address), deskBalances(buyer.wallet!.address)]);
  const cash = (BigInt(DEMO_PAR) * BigInt(Math.round(Number(DEMO_PRICE) * 10_000)) * 1_000_000n) / (100n * 10_000n);
  if (BigInt(s.par) < BigInt(DEMO_PAR) || BigInt(s.loanAllowance) < BigInt(DEMO_PAR)) throw new Error(`${seller.name} needs at least $${Number(DEMO_PAR).toLocaleString("en-US")} par and a standing loan authorisation.`);
  if (BigInt(b.usd) < cash || BigInt(b.usdAllowance) < cash) throw new Error(`${buyer.name} needs enough mock USD and a standing cash authorisation.`);
  const now = Math.floor(Date.now() / 1000);
  const runId = `transfer-${randomUUID().slice(0, 8)}`;
  const rfqEvent = { type: "rfq" as const, rfqId: `rfq-${runId}`, facility: readOrg() && "MHTLB-A", side: "sell" as const, par: DEMO_PAR, deadline: now + 3600, institution: seller.id, by: `demo:${runId}` };
  const quoteEvent = { type: "quote" as const, rfqId: rfqEvent.rfqId, quoteId: `q-${runId}`, price: DEMO_PRICE, settleAt: now + SETTLE_S, expiresAt: now + 3600, institution: buyer.id, by: `demo:${runId}` };
  const rfqReceipt = await publish(rfqEvent);
  const quoteReceipt = await publish(quoteEvent);
  const quote: Quote = { ...quoteEvent, sequence: quoteReceipt.sequence, consensusAt: "" };
  const rfq: Rfq = { ...rfqEvent, sequence: rfqReceipt.sequence, consensusAt: "", quotes: [quote], status: "open" };
  return acceptQuote(rfq, quote, `demo:${runId}`, { kind: "transfer-demo", runId, manualConsent: true, automatedInstitutions: [seller.id, buyer.id], requestedBy: userId });
}
