import { jsonStore } from "./store";

/** Venue-side record of a settlement instruction and the desk approvals attached to it. */
export interface DeskApproval {
  institution: string;
  wallet: string;
  intentId: string;
  proposedAt: number;
  /** Privy intent status as last seen */
  intentStatus?: string;
  signatures?: number;
  threshold?: number;
  /** Hedera broadcast of the executed intent's signed approve() transaction */
  txHash?: string;
  broadcastAt?: number;
  broadcastError?: string;
}

export interface TradeRecord {
  tradeId: string;
  rfqId: string;
  quoteId: string;
  instructionHash: string;
  createTx: string;
  facility: string;
  seller: { institution: string; wallet: string };
  buyer: { institution: string; wallet: string };
  par: string; // loan token units (1 = $1 par)
  price: string; // e.g. "99.25"
  cash: string; // mock USD smallest units (6 dp)
  settleAt: number;
  expiresAt: number;
  approvals: { seller: DeskApproval; buyer: DeskApproval };
  /** engine state snapshot */
  state?: string;
  scheduleAddress?: string;
  failureReason?: string;
  settledAt?: number;
  createdAt: number;
  updatedAt: number;
}

export const trades = jsonStore<{ trades: TradeRecord[] }>("trades", { trades: [] });

export function findTrade(tradeId: string) {
  return trades.read().trades.find((t) => t.tradeId === tradeId) ?? null;
}
