import { readTopic, publish, type RfqEvent, type HcsMessage } from "./hcs";
import { readOrg } from "./org";
import { trades, type TradeRecord } from "./trades";
import { createInstruction, rfqRef, approveCalldata, getTrade } from "./engine";
import { proposeDeskTx, fetchIntent, broadcastIntent, signedTxOf } from "./desk-tx";
import { venue } from "./venue";

export interface Quote {
  quoteId: string;
  institution: string;
  by: string;
  price: string;
  settleAt: number;
  expiresAt: number;
  consensusAt: string;
  sequence: number;
}
export interface Rfq {
  rfqId: string;
  facility: string;
  side: "sell" | "buy";
  par: string;
  deadline: number;
  institution: string;
  by: string;
  consensusAt: string;
  sequence: number;
  quotes: Quote[];
  status: "open" | "accepted" | "cancelled" | "expired";
  acceptedQuoteId?: string;
  trade?: TradeRecord;
}

/** Fold the HCS topic into RFQ state. The topic is the audit trail; this is a read model. */
export async function loadRfqs(): Promise<{ rfqs: Rfq[]; messages: HcsMessage[] }> {
  const messages = await readTopic();
  const byId = new Map<string, Rfq>();
  for (const m of messages) {
    const e = m.event as RfqEvent;
    if (e.type === "rfq") {
      byId.set(e.rfqId, { ...e, consensusAt: m.consensusAt, sequence: m.sequence, quotes: [], status: "open" });
    } else if (e.type === "quote") {
      const r = byId.get(e.rfqId);
      if (r && r.status === "open") r.quotes.push({ quoteId: e.quoteId, institution: e.institution, by: e.by, price: e.price, settleAt: e.settleAt, expiresAt: e.expiresAt, consensusAt: m.consensusAt, sequence: m.sequence });
    } else if (e.type === "accept") {
      const r = byId.get(e.rfqId);
      if (r && r.status === "open" && r.quotes.some((q) => q.quoteId === e.quoteId)) {
        r.status = "accepted";
        r.acceptedQuoteId = e.quoteId;
      }
    } else if (e.type === "cancel") {
      const r = byId.get(e.rfqId);
      if (r && r.status === "open") r.status = "cancelled";
    }
  }
  const now = Date.now() / 1000;
  const all = trades.read().trades;
  for (const r of byId.values()) {
    if (r.status === "open" && r.deadline < now) r.status = "expired";
    r.trade = all.find((t) => t.rfqId === r.rfqId);
  }
  return { rfqs: [...byId.values()].sort((a, b) => b.sequence - a.sequence), messages };
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Accepting a quote records the assignment and asks the arranger for consent. Nothing touches the
 * engine yet: in the market the administrative agent processes an assignment before it settles, and
 * here that step is explicit (a platform admin consents in the registry, or the arranger automation
 * does after AGENT_CONSENT_DELAY_S).
 */
export async function acceptQuote(rfq: Rfq, quote: Quote, acceptedBy: string) {
  const org = readOrg();
  const sellerInst = org.institutions.find((i) => i.id === (rfq.side === "sell" ? rfq.institution : quote.institution));
  const buyerInst = org.institutions.find((i) => i.id === (rfq.side === "sell" ? quote.institution : rfq.institution));
  if (!sellerInst?.wallet || !buyerInst?.wallet) throw new Error("both desks need a provisioned wallet");

  const par = BigInt(rfq.par);
  const priceBps = BigInt(Math.round(Number(quote.price) * 10_000)); // price per 100 par, 4 dp
  const cash = (par * priceBps * 1_000_000n) / (100n * 10_000n); // 6 dp USD
  const settleAt = quote.settleAt;
  const expiresAt = Math.max(quote.expiresAt, settleAt + 3600);

  await publish({ type: "accept", rfqId: rfq.rfqId, quoteId: quote.quoteId, institution: sellerInst.id, by: acceptedBy });

  const now = Date.now();
  const record: TradeRecord = {
    tradeId: `pending-${quote.quoteId}`,
    rfqId: rfq.rfqId,
    quoteId: quote.quoteId,
    instructionHash: "",
    createTx: "",
    facility: rfq.facility,
    seller: { institution: sellerInst.id, wallet: sellerInst.wallet.address },
    buyer: { institution: buyerInst.id, wallet: buyerInst.wallet.address },
    par: par.toString(),
    price: quote.price,
    cash: cash.toString(),
    settleAt,
    expiresAt,
    approvals: {
      seller: { institution: sellerInst.id, wallet: sellerInst.wallet.address, intentId: "", proposedAt: 0 },
      buyer: { institution: buyerInst.id, wallet: buyerInst.wallet.address, intentId: "", proposedAt: 0 },
    },
    consent: { status: "pending", requestedAt: now },
    state: "AwaitingAgentConsent",
    createdAt: now,
    updatedAt: now,
  };
  trades.write((s) => s.trades.push(record));
  return record;
}

/** The arranger consents: the instruction goes on-chain and each desk is asked to approve it. */
export async function grantConsent(provisionalTradeId: string, grantedBy: string, auto = false) {
  const t = trades.read().trades.find((x) => x.tradeId === provisionalTradeId);
  if (!t) throw new Error("assignment not found");
  if (t.consent?.status === "granted" || !t.tradeId.startsWith("pending-")) return t;
  const org = readOrg();
  const sellerInst = org.institutions.find((i) => i.id === t.seller.institution)!;
  const buyerInst = org.institutions.find((i) => i.id === t.buyer.institution)!;
  const par = BigInt(t.par);
  const cash = BigInt(t.cash);
  const created = await createInstruction({ buyer: t.buyer.wallet, seller: t.seller.wallet, par, cash, settleAt: t.settleAt, expiresAt: t.expiresAt, rfqRef: rfqRef(t.rfqId, t.quoteId) });
  await publish({ type: "instruction", rfqId: t.rfqId, quoteId: t.quoteId, tradeId: created.tradeId, instructionHash: created.instructionHash, engine: venue().settlementEngine, txHash: created.txHash });
  const data = approveCalldata(created.tradeId, created.instructionHash);
  const sellerIntent = await proposeDeskTx({ walletId: sellerInst.wallet!.id, walletAddress: sellerInst.wallet!.address, to: venue().settlementEngine, data, gasLimit: 2_500_000 });
  const buyerIntent = await proposeDeskTx({ walletId: buyerInst.wallet!.id, walletAddress: buyerInst.wallet!.address, to: venue().settlementEngine, data, gasLimit: 2_500_000 });
  const now = Date.now();
  const updated: TradeRecord = {
    ...t,
    tradeId: created.tradeId,
    instructionHash: created.instructionHash,
    createTx: created.txHash,
    approvals: {
      seller: { institution: sellerInst.id, wallet: sellerInst.wallet!.address, intentId: sellerIntent.intent_id, proposedAt: now, intentStatus: sellerIntent.status, threshold: sellerIntent.authorization_details[0]?.threshold, signatures: 0 },
      buyer: { institution: buyerInst.id, wallet: buyerInst.wallet!.address, intentId: buyerIntent.intent_id, proposedAt: now, intentStatus: buyerIntent.status, threshold: buyerIntent.authorization_details[0]?.threshold, signatures: 0 },
    },
    consent: { status: "granted", requestedAt: t.consent?.requestedAt ?? t.createdAt, grantedAt: now, grantedBy, auto },
    state: "AwaitingApprovals",
    updatedAt: now,
  };
  trades.write((s) => { const i = s.trades.findIndex((x) => x.tradeId === provisionalTradeId); if (i >= 0) s.trades[i] = updated; });
  return updated;
}

/**
 * Reconcile every open trade: pull intent progress from Privy, broadcast executed approvals to
 * Hedera in order, refresh engine state, and anchor state changes on the HCS topic.
 */
export async function syncTrades() {
  const open = trades.read().trades.filter((t) => !["Settled", "Cancelled", "AwaitingAgentConsent"].includes(t.state ?? "") && !t.tradeId.startsWith("pending-"));
  const events: string[] = [];
  for (const t of open) {
    for (const side of ["seller", "buyer"] as const) {
      const a = t.approvals[side];
      if (a.txHash) continue;
      try {
        const intent = await fetchIntent(a.intentId);
        const q = intent.authorization_details[0];
        a.intentStatus = intent.status;
        a.signatures = q?.members.filter((m) => m.signed_at).length ?? 0;
        a.threshold = q?.threshold;
        if (intent.status === "executed" && signedTxOf(intent)) {
          const r = await broadcastIntent(intent);
          a.txHash = r.hash;
          a.broadcastAt = Date.now();
          a.broadcastError = r.status === 1 ? undefined : "reverted";
          events.push(`broadcast ${side} approval of trade ${t.tradeId}: ${r.hash}`);
          await publish({ type: "approval", tradeId: t.tradeId, institution: a.institution, intentId: a.intentId, txHash: r.hash });
        }
      } catch (e) {
        a.broadcastError = (e as Error).message.slice(0, 200);
      }
    }
    try {
      const onchain = await getTrade(t.tradeId);
      const prev = t.state;
      t.state = onchain.state;
      t.scheduleAddress = onchain.scheduleAddress && onchain.scheduleAddress !== "0x0000000000000000000000000000000000000000" ? onchain.scheduleAddress : t.scheduleAddress;
      t.failureReason = onchain.failureReason && onchain.failureReason !== "0x" ? onchain.failureReason : undefined;
      if (onchain.state === "Settled" && !t.settledAt) t.settledAt = Date.now();
      if (prev !== onchain.state) {
        events.push(`trade ${t.tradeId}: ${prev} -> ${onchain.state}`);
        await publish({ type: "settlement", tradeId: t.tradeId, state: onchain.state, scheduleId: t.scheduleAddress });
      }
    } catch (e) {
      events.push(`engine read failed for ${t.tradeId}: ${(e as Error).message.slice(0, 120)}`);
    }
    t.updatedAt = Date.now();
    trades.write((s) => {
      const i = s.trades.findIndex((x) => x.tradeId === t.tradeId);
      if (i >= 0) s.trades[i] = t;
    });
  }
  return events;
}
