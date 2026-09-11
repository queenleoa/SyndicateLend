import { AccountId, Client, PrivateKey, TopicId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import fs from "node:fs";
import path from "node:path";

/**
 * RFQ audit trail on the Hedera Consensus Service. Every market event (RFQ, quote, acceptance,
 * settlement instruction, receipts) is a JSON message on the venue's RFQ topic, ordered and
 * timestamped by consensus. The venue service (administrative agent key) submits on behalf of
 * authenticated desks; the message carries the desk's institution id and Privy user id.
 */
export type RfqEvent =
  | { type: "rfq"; rfqId: string; facility: string; side: "sell" | "buy"; par: string; deadline: number; institution: string; by: string }
  | { type: "quote"; rfqId: string; quoteId: string; price: string; settleAt: number; expiresAt: number; institution: string; by: string }
  | { type: "accept"; rfqId: string; quoteId: string; institution: string; by: string }
  | { type: "instruction"; rfqId: string; quoteId: string; tradeId: string; instructionHash: string; engine: string; txHash: string }
  | { type: "approval"; tradeId: string; institution: string; intentId: string; txHash: string }
  | { type: "settlement"; tradeId: string; state: string; txHash?: string; scheduleId?: string }
  | { type: "cancel"; rfqId: string; institution: string; by: string };

export interface HcsMessage<T = RfqEvent> {
  sequence: number;
  consensusAt: string; // seconds.nanos
  payer: string;
  event: T;
}

const MIRROR = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

function deployments() {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../ops/deployments/testnet.json"), "utf8"));
}
export function rfqTopicId(): string {
  return deployments().topics.rfq;
}
export function noticeTopicId(): string {
  return deployments().topics.notices;
}

let client: Client | null = null;
function venueClient() {
  if (!client) {
    client = Client.forTestnet();
    client.setOperator(AccountId.fromString(process.env.OPERATOR_ACCOUNT_ID!), PrivateKey.fromStringECDSA(process.env.OPERATOR_PRIVATE_KEY!));
  }
  return client;
}

export async function publish(event: RfqEvent, topic = rfqTopicId()) {
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topic))
    .setMessage(JSON.stringify({ v: 1, at: Date.now(), ...event }))
    .execute(venueClient());
  const receipt = await tx.getReceipt(venueClient());
  return { sequence: receipt.topicSequenceNumber?.toNumber() ?? 0, transactionId: tx.transactionId.toString(), status: receipt.status.toString() };
}

/** Read the whole topic (paginated) and decode JSON events, oldest first. */
export async function readTopic<T = RfqEvent>(topic = rfqTopicId()): Promise<HcsMessage<T>[]> {
  const out: HcsMessage<T>[] = [];
  let next: string | null = `/api/v1/topics/${topic}/messages?limit=100&order=asc`;
  while (next) {
    const res = await fetch(`${MIRROR}${next}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`mirror topic read failed: ${res.status}`);
    const j = (await res.json()) as { messages: { sequence_number: number; consensus_timestamp: string; payer_account_id: string; message: string }[]; links: { next: string | null } };
    for (const m of j.messages) {
      try {
        const event = JSON.parse(Buffer.from(m.message, "base64").toString("utf8")) as T;
        out.push({ sequence: m.sequence_number, consensusAt: m.consensus_timestamp, payer: m.payer_account_id, event });
      } catch {
        // ignore non-JSON messages on the topic
      }
    }
    next = j.links?.next ?? null;
  }
  return out;
}

export function hashscanTopic(topic = rfqTopicId()) {
  return `https://hashscan.io/testnet/topic/${topic}`;
}
