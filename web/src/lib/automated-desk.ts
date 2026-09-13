import { generateAuthorizationSignature, formatRequestForAuthorizationSignature, type WalletApiRequestSignatureInput } from "@privy-io/node";
import { privy } from "./privy-server";
import { readOrg, type Institution } from "./org";
import { jsonStore } from "./store";
import { loadRfqs, acceptQuote, grantConsent, newId, syncTrades } from "./rfq";
import { onboardingOf, topUpGas } from "./onboarding";
import { trades } from "./trades";
import { publish } from "./hcs";
import { listWalletIntents, submitIntentSignature } from "./approvals";
import { advanceOnboarding, onboardingReady } from "./self-service";
import { HostedDemoError, hostedRead, withHostedLease } from "./demo/hosted-store";
import { automationPrivateKeys } from "./automation-keys";

/**
 * Automated desks. Their Privy quorum is two server-held P-256 keys (AUTOMATED_DESK_KEYS, comma-separated
 * PKCS8 DER base64), so the venue can authorise their intents itself. The market maker (Aldgate) exists so a
 * judge always has a counterparty: it quotes every open RFQ from another desk, keeps one buy and one sell
 * RFQ of its own open, accepts the best quote it receives, and approves its side of every trade. The demo
 * counterparty (Bishopsgate) only trades when the agent-bank transfer-request demo asks it to.
 * Judge desks stay user-bound: their trader signs, and the first automation key only ever adds the second
 * (compliance) signature to an intent that trader already approved. Automated desks are labelled as such.
 *
 * `marketTick()` runs after API responses (Next `after`), rate-limited, so a hosted deployment needs no
 * long-running process: any page load drives the market. It takes the same operator lease as the issuance
 * wizard, so the agent bank's account never signs two workflows at once.
 */
const market = jsonStore<{ lastTickAt: number; log: string[] }>("market", { lastTickAt: 0, log: [] });
const TICK_MS = 10_000;

export function automatedDesks(): Institution[] {
  return readOrg().institutions.filter((i) => i.automated && !i.registryDemo && i.wallet);
}
/** The market maker: the automated desk that quotes and keeps RFQs open. */
export function automatedDesk(): Institution | null {
  return automatedDesks().find((i) => !i.demoCounterparty) ?? null;
}
function keys(): string[] {
  return automationPrivateKeys();
}
export function automatedDeskConfigured() {
  return keys().length >= 2 && automatedDesk() !== null;
}
export function isAutomated(institutionId: string) {
  return automatedDesks().some((i) => i.id === institutionId);
}

/** Authorise an intent on an automated desk's wallet with both server keys. */
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

type QuorumIntent = { intent_id: string; status: string; expires_at?: number; resource_id?: string; authorization_details?: { threshold: number; members: { type?: string; signed_at: number | null }[] }[] };

/**
 * Automated compliance co-signature on a judge desk: once the human member has signed, the venue's
 * co-signer key completes the quorum. Never signs an intent no human has approved.
 */
export async function cosignIfHumanSigned(intentId: string): Promise<string> {
  const [cosigner] = keys();
  if (!cosigner) return "no co-signer key configured";
  const it = (await privy().intents().get(intentId)) as unknown as QuorumIntent & { request_details: { method: string; url: string; body: unknown } };
  if (it.status !== "pending") return it.status;
  const quorum = it.authorization_details?.[0];
  const humanSigned = quorum?.members.some((m) => m.type === "user" && m.signed_at != null) ?? false;
  if (!humanSigned) return "awaiting the trader";
  const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
  const timestamp = Date.now();
  const input = { version: 1, method: it.request_details.method, url: it.request_details.url, body: it.request_details.body, timestamp, intent_id: intentId, headers: { "privy-app-id": appId, "privy-request-expiry": String(it.expires_at) } } as unknown as WalletApiRequestSignatureInput;
  const signature = generateAuthorizationSignature({ authorizationPrivateKey: `wallet-auth:${cosigner}`, input: formatRequestForAuthorizationSignature(input) });
  const r = (await submitIntentSignature(intentId, signature, timestamp)) as { status?: string };
  return r.status ?? "signed";
}

/** Co-sign every pending intent on a judge desk that its trader has already approved. */
export async function cosignPendingForDesk(inst: Institution): Promise<string[]> {
  if (inst.cosigner !== "automated" || !inst.wallet || keys().length === 0) return [];
  const out: string[] = [];
  const intents = (await listWalletIntents(inst.wallet.id)) as QuorumIntent[];
  for (const it of intents.filter((i) => i.status === "pending" && (i.expires_at ?? Infinity) > Date.now())) {
    const humanSigned = it.authorization_details?.[0]?.members.some((m) => m.type === "user" && m.signed_at != null);
    if (!humanSigned) continue;
    try { out.push(`${it.intent_id}: ${await cosignIfHumanSigned(it.intent_id)}`); } catch (e) { out.push(`${it.intent_id}: ${(e as Error).message.slice(0, 120)}`); }
  }
  return out;
}

/** Sign every pending intent on an automated desk (onboarding steps and trade approvals). */
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

/** Sign the automated sides of a trade right away (the counterpart of a judge's own signatures). */
export async function authorizeAutomatedSides(tradeId: string): Promise<string[]> {
  const t = trades.read().trades.find((x) => x.tradeId === tradeId);
  if (!t || keys().length < 2) return [];
  const out: string[] = [];
  for (const side of ["seller", "buyer"] as const) {
    const a = t.approvals[side];
    if (!a.intentId || a.txHash || !isAutomated(a.institution)) continue;
    try { out.push(`${a.institution} ${side}: ${await authorizeWithAppKeys(a.intentId)}`); } catch (e) { out.push(`${a.institution} ${side}: ${(e as Error).message.slice(0, 120)}`); }
  }
  return out;
}

/** Is the agent bank's signing account reserved by a browser workflow (issuance) right now? */
export async function operatorReserved(): Promise<boolean> {
  return Boolean(await hostedRead<{ kind: string } | null>("operator-workflow").catch(() => null));
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
  if (await operatorReserved()) return []; // a loan issuance owns the agent's signing account
  try {
    return await withHostedLease("operator-transactions", async (lease) => {
      market.write((s) => { s.lastTickAt = Date.now(); });
      const log = await tick(() => lease.renew().catch(() => undefined));
      market.write((s) => { s.log = [...log, ...s.log].slice(0, 200); });
      return log;
    });
  } catch (e) {
    if (e instanceof HostedDemoError && e.status === 409) return []; // another request holds the operator lease
    throw e;
  }
}

async function tick(renew: () => Promise<void>): Promise<string[]> {
  const log: string[] = [];
  const org = readOrg();
  const bots = automatedDesks();
  const bot = automatedDesk();

  // 1. Automated desks: sign whatever is waiting for them.
  if (keys().length >= 2) {
    for (const auto of bots) {
      try { log.push(...(await authorizePendingAutomatedIntents(auto)).map((x) => `${auto.id} sign ${x}`)); } catch (e) { log.push(`${auto.id} sign failed: ${(e as Error).message}`); }
    }
  }
  // 1b. Judge desks: add the automated compliance co-signature wherever the trader has already signed.
  for (const inst of org.institutions.filter((i) => i.cosigner === "automated" && i.wallet)) {
    try { log.push(...(await cosignPendingForDesk(inst)).map((x) => `${inst.id} co-sign ${x}`)); } catch (e) { log.push(`${inst.id} co-sign failed: ${(e as Error).message.slice(0, 120)}`); }
  }
  // 2. Every desk: keep a gas float, advance the operator side of onboarding one step, broadcast executed desk steps.
  for (const inst of org.institutions.filter((i) => i.wallet && !i.registryDemo)) {
    try {
      if (onboardingOf(inst).accountId) { const topUp = await topUpGas(inst.id); if (topUp) log.push(`${inst.id}: gas top-up ${topUp}`); }
      const step = await advanceOnboarding(inst.id);
      if (step) log.push(`${inst.id}: ${step}`);
    } catch (e) {
      log.push(`${inst.id} onboarding: ${(e as Error).message.slice(0, 160)}`);
    }
    await renew();
  }
  // 3. Arranger automation: consent to assignments nobody consented to within the delay, then put the
  //    instruction on-chain and ask both desks to approve. Then broadcast approvals, refresh engine state.
  const delayMs = Number(process.env.AGENT_CONSENT_DELAY_S ?? "45") * 1000;
  for (const t of trades.read().trades.filter((x) => !x.demo?.manualConsent && x.consent?.status === "pending" && Date.now() - x.consent.requestedAt >= delayMs)) {
    try {
      const u = await grantConsent(t.tradeId, "arranger-automation", true);
      log.push(`arranger consented to ${t.rfqId}: instruction ${u.tradeId}`);
      log.push(...(await authorizeAutomatedSides(u.tradeId)).map((x) => `auto approve ${x}`));
    } catch (e) {
      log.push(`consent failed for ${t.tradeId}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  // Consented trades whose automated side has not signed yet (for example after the agent bank's manual consent).
  for (const t of trades.read().trades.filter((x) => x.consent?.status === "granted" && !["Settled", "Cancelled", "Failed"].includes(x.state ?? "") && (["seller", "buyer"] as const).some((side) => x.approvals[side].intentId && !x.approvals[side].txHash && isAutomated(x.approvals[side].institution)))) {
    log.push(...(await authorizeAutomatedSides(t.tradeId)).map((x) => `auto approve ${x}`));
  }
  await renew();
  try { log.push(...(await syncTrades())); } catch (e) { log.push(`sync: ${(e as Error).message.slice(0, 160)}`); }

  // 4. Market making, once the market maker holds par and cash.
  if (bot?.wallet && keys().length >= 2 && onboardingReady(bot)) {
    const { rfqs } = await loadRfqs();
    const now = Math.floor(Date.now() / 1000);
    for (const r of rfqs.filter((x) => x.status === "open" && x.institution !== bot.id && x.deadline > now && !x.quotes.some((q) => q.institution === bot.id))) {
      const counterparty = org.institutions.find((i) => i.id === r.institution);
      if (!counterparty?.wallet || counterparty.demoCounterparty) continue; // the demo counterparty trades only through the transfer-request demo
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
  return log;
}
