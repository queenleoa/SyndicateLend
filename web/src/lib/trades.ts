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

/** Arranger (administrative agent) consent to the assignment. Granted by a platform admin in the registry, or by the arranger automation after a delay. */
export interface AgentConsent {
  status: "pending" | "granted";
  requestedAt: number;
  grantedAt?: number;
  grantedBy?: string;
  auto?: boolean;
}

export interface TradeRecord {
  /** Synthetic demo assignment between two automated institutions; the agent bank must consent manually. */
  demo?: {
    kind: "transfer-demo" | "agent-registry";
    runId: string;
    manualConsent: true;
    automatedInstitutions: [string, string];
    requestedBy?: string;
  };
  /** On-chain instruction id once the arranger has consented; before that a provisional `pending-…` id. */
  tradeId: string;
  rfqId: string;
  quoteId: string;
  instructionHash: string;
  createTx: string;
  /** Recorded after publication so interrupted consent can resume the HCS audit step. */
  instructionHcsSequence?: number;
  facility: string;
  seller: { institution: string; wallet: string };
  buyer: { institution: string; wallet: string };
  par: string; // loan token units (1 = $1 par)
  price: string; // e.g. "99.25"
  cash: string; // mock USD smallest units (6 dp)
  settleAt: number;
  expiresAt: number;
  approvals: { seller: DeskApproval; buyer: DeskApproval };
  consent?: AgentConsent;
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
