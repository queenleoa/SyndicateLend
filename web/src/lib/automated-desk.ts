import { generateAuthorizationSignature, formatRequestForAuthorizationSignature, type WalletApiRequestSignatureInput } from "@privy-io/node";
import { privy } from "./privy-server";
import { readOrg, type Institution } from "./org";
import { jsonStore } from "./store";
import { loadRfqs, acceptQuote, grantConsent, newId, syncTrades } from "./rfq";
import { trades } from "./trades";
import { publish } from "./hcs";
import { listWalletIntents, submitIntentSignature } from "./approvals";
import { advanceOnboarding, onboardingReady } from "./self-service";

/**
 * The automated liquidity desk. Its Privy quorum is two server-held P-256 keys (AUTOMATED_DESK_KEYS,
 * comma-separated PKCS8 DER base64), so the venue can authorise its intents itself. It exists so a
 * judge always has a counterparty: it quotes every open RFQ from another desk, keeps one buy and one
 * sell RFQ of its own open, accepts the best quote it receives, and approves its side of every trade.
 * The judge's desk stays a user-bound 2-of-3; only this desk is automated, and it is labelled as such.
 *
 * `marketTick()` runs after API responses (Next `after`), rate-limited, so a hosted deployment needs no
 * long-running process: any page load drives the market.
 */
const market = jsonStore<{ lastTickAt: number; log: string[] }>("market", { lastTickAt: 0, log: [] });
const TICK_MS = 20_000;

export function automatedDesk(): Institution | null {
  return readOrg().institutions.find((i) => i.automated) ?? null;
}
function keys(): string[] {
  return (process.env.AUTOMATED_DESK_KEYS ?? "").split(",").map((k) => k.trim()).filter(Boolean);
}
export function automatedDeskConfigured() {
  return keys().length >= 2 && automatedDesk() !== null;
}

/** Authorise an intent on the automated desk's wallet with both server keys. */
export async function authorizeWithAppKeys(intentId: string) {
  const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
  const it = (await privy().intents().get(intentId)) as unknown as { status: string; expires_at: number; request_details: { method: string; url: string; body: unknown } };
  if (it.status !== "pending") return it.status;
  const rd = it.request_details;
  const timestamp = Date.now();
  const headers = { "privy-app-id": appId, "privy-request-expiry": String(it.expires_at) };
  const input = { version: 1, method: rd.method, url: rd.url, body: rd.body, timestamp, intent_id: intentId, headers } as unknown as WalletApiRequestSignatureInput;
  const bytes = formatRequestForAuthorizationSignature(input);
  let last = "";
  for (const k of keys()) {
    const signature = generateAuthorizationSignature({ authorizationPrivateKey: `wallet-auth:${k}`, input: bytes });
    const r = (await submitIntentSignature(intentId, signature, timestamp)) as { status?: string };
    last = r.status ?? "";
    if (last === "executed") break;
  }
  return last;
}

/** Sign every pending intent on the automated desk (onboarding steps and trade approvals). */
export async function authorizePendingAutomatedIntents(bot: Institution): Promise<string[]> {
  const out: string[] = [];
  const intents = (await listWalletIntents(bot.wallet!.id)) as { intent_id: string; status: string }[];
  for (const it of intents.filter((i) => i.status === "pending")) {
    try {
      out.push(`${it.intent_id}: ${await authorizeWithAppKeys(it.intent_id)}`);
    } catch (e) {
      out.push(`${it.intent_id}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return out;
}

const BOT_BID = "99.00"; // what the desk pays when someone sells
const BOT_ASK = "99.25"; // what the desk asks when someone buys
const BOT_PAR = "1000000";
const SETTLE_MIN = 3;
const VALID_MIN = 30;

/** One pass of the market maker and of every desk's onboarding. Safe to call often; rate-limited. */
export async function marketTick(force = false): Promise<string[]> {
  const m = market.read();
  if (!force && Date.now() - m.lastTickAt < TICK_MS) return [];
  market.write((s) => { s.lastTickAt = Date.now(); });
  const log: string[] = [];
  const org = readOrg();
  const bot = org.institutions.find((i) => i.automated) ?? null;

  // 1. Automated desk: sign whatever is waiting for it.
  if (bot?.wallet && keys().length >= 2) {
    try { log.push(...(await authorizePendingAutomatedIntents(bot)).map((x) => `bot sign ${x}`)); } catch (e) { log.push(`bot sign failed: ${(e as Error).message}`); }
  }
  // 2. Every desk: advance the operator side of onboarding one step, broadcast executed desk steps.
  for (const inst of org.institutions.filter((i) => i.wallet)) {
    try {
      const step = await advanceOnboarding(inst.id);
      if (step) log.push(`${inst.id}: ${step}`);
    } catch (e) {
      log.push(`${inst.id} onboarding: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  // 3. Arranger automation: consent to assignments nobody consented to within the delay, then put the
  //    instruction on-chain and ask both desks to approve. Then broadcast approvals, refresh engine state.
  const delayMs = Number(process.env.AGENT_CONSENT_DELAY_S ?? "45") * 1000;
  for (const t of trades.read().trades.filter((x) => x.consent?.status === "pending" && Date.now() - x.consent.requestedAt >= delayMs)) {
    try {
      const u = await grantConsent(t.tradeId, "arranger-automation", true);
      log.push(`arranger consented to ${t.rfqId}: instruction ${u.tradeId}`);
      if (bot && (u.seller.institution === bot.id || u.buyer.institution === bot.id) && keys().length >= 2) {
        const mine = u.seller.institution === bot.id ? u.approvals.seller : u.approvals.buyer;
        log.push(`bot approve ${await authorizeWithAppKeys(mine.intentId)}`);
      }
    } catch (e) {
      log.push(`consent failed for ${t.tradeId}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  try { log.push(...(await syncTrades())); } catch (e) { log.push(`sync: ${(e as Error).message.slice(0, 160)}`); }

  // 4. Market making, once the automated desk holds par and cash.
  if (bot?.wallet && keys().length >= 2 && onboardingReady(bot)) {
    const { rfqs } = await loadRfqs();
    const now = Math.floor(Date.now() / 1000);
    for (const r of rfqs.filter((x) => x.status === "open" && x.institution !== bot.id && x.deadline > now && !x.quotes.some((q) => q.institution === bot.id))) {
      const counterparty = org.institutions.find((i) => i.id === r.institution);
      if (!counterparty?.wallet) continue;
      const price = r.side === "sell" ? BOT_BID : BOT_ASK;
      await publish({ type: "quote", rfqId: r.rfqId, quoteId: newId("q"), price, settleAt: now + SETTLE_MIN * 60, expiresAt: now + VALID_MIN * 60, institution: bot.id, by: "automated" });
      log.push(`quoted ${r.rfqId} at ${price}`);
    }
    for (const r of rfqs.filter((x) => x.status === "open" && x.institution === bot.id)) {
      const live = r.quotes.filter((q) => q.institution !== bot.id && q.expiresAt > now && q.settleAt > now);
      if (live.length === 0) continue;
      const best = [...live].sort((a, b) => (r.side === "sell" ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price)))[0];
      try {
        const t = await acceptQuote(r, best, "automated");
        log.push(`accepted ${best.quoteId} on ${r.rfqId}: awaiting arranger consent (${t.tradeId})`);
      } catch (e) {
        log.push(`accept failed on ${r.rfqId}: ${(e as Error).message.slice(0, 160)}`);
      }
    }
    for (const side of ["sell", "buy"] as const) {
      const open = rfqs.some((x) => x.status === "open" && x.institution === bot.id && x.side === side && x.deadline > now);
      if (open) continue;
      await publish({ type: "rfq", rfqId: newId("rfq"), facility: "MHTLB-A", side, par: BOT_PAR, deadline: now + 24 * 3600, institution: bot.id, by: "automated" });
      log.push(`published ${side} RFQ`);
    }
  }
  market.write((s) => { s.log = [...log, ...s.log].slice(0, 200); });
  return log;
}
