import { privy } from "./privy-server";
import { txFields, broadcast, transactionOutcome, walletNonce } from "./hedera";
import { venue } from "./venue";
import { Transaction } from "ethers";
import { nextUnreservedNonce, type NonceIntent } from "./desk-nonce";
import { hostedStorageConfigured, withHostedLease } from "./demo/hosted-store";

/**
 * Desk-wallet transactions: proposed as Privy intents (quorum-approved), executed by Privy as a
 * signed RLP transaction, then broadcast to Hedera by the venue service.
 */

/**
 * Reserve the first unused nonce. A rejected future-nonce approval must not leave a permanent gap.
 * Privy reads fail closed: a trade-count fallback does not know about wallet setup approvals.
 */
async function nextNonce(walletId: string, wallet: string, requireCurrentNonce = false) {
  const fields = await txFields(wallet);
  const intents: NonceIntent[] = [];
  const page = await privy().intents().list({ resource_id: walletId, sort_by: "created_at_desc", limit: 50 } as never);
  for await (const item of page) {
    const intent = item as unknown as NonceIntent & IntentView;
    const signed = signedTxOf(intent);
    if (intent.status === "executed" && signed) {
      const tx = Transaction.from(signed);
      if (tx.nonce >= fields.nonce && tx.hash && (await transactionOutcome(tx.hash))?.status === 0) continue;
    }
    intents.push(intent);
  }
  const currentNonce = await walletNonce(wallet);
  const nonce = nextUnreservedNonce(currentNonce, intents, venue().chainId);
  if (requireCurrentNonce && nonce !== currentNonce) throw new Error("Another institution approval already reserves the next wallet nonce. Complete or reject that approval before retrying setup.");
  return { ...fields, nonce };
}

const proposalRegistry = globalThis as typeof globalThis & { syndicatelendProposalTails?: Map<string, Promise<unknown>> };
const proposalTails = proposalRegistry.syndicatelendProposalTails ??= new Map<string, Promise<unknown>>();

export async function proposeDeskTx(input: { walletId: string; walletAddress: string; to: string; data: string; gasLimit?: number; requireCurrentNonce?: boolean }) {
  const prior = proposalTails.get(input.walletId) ?? Promise.resolve();
  const work = prior.catch(() => undefined).then(() => hostedStorageConfigured()
    ? withHostedLease(`wallet-nonce:${input.walletId}`, () => propose(input)) : propose(input));
  proposalTails.set(input.walletId, work);
  try { return await work; }
  finally { if (proposalTails.get(input.walletId) === work) proposalTails.delete(input.walletId); }
}

async function propose(input: { walletId: string; walletAddress: string; to: string; data: string; gasLimit?: number; requireCurrentNonce?: boolean }) {
  const fields = await nextNonce(input.walletId, input.walletAddress, input.requireCurrentNonce);
  const tx = {
    to: input.to,
    data: input.data,
    value: "0x0",
    chain_id: venue().chainId,
    type: 2,
    nonce: fields.nonce,
    gas_limit: input.gasLimit ?? fields.gas_limit,
    max_fee_per_gas: fields.max_fee_per_gas,
    max_priority_fee_per_gas: fields.max_priority_fee_per_gas,
  };
  const intent = await privy().intents().rpc(input.walletId, { method: "eth_signTransaction", params: { transaction: tx } } as never);
  return intent as unknown as { intent_id: string; status: string; authorization_details: { threshold: number; members: { signed_at: number | null }[] }[] };
}

export interface IntentView {
  intent_id: string;
  resource_id?: string;
  request_details?: NonceIntent["request_details"];
  status: string;
  authorization_details: { threshold: number; members: { signed_at: number | null; user_id?: string }[] }[];
  action_result?: { response_body?: { data?: { signed_transaction?: string } } };
}

export async function fetchIntent(intentId: string): Promise<IntentView> {
  return (await privy().intents().get(intentId)) as unknown as IntentView;
}

export function signedTxOf(intent: IntentView): string | null {
  return intent.action_result?.response_body?.data?.signed_transaction ?? null;
}

/** Broadcast the executed intent's signed transaction. Returns the Hedera tx hash. */
export async function broadcastIntent(intent: IntentView) {
  const rlp = signedTxOf(intent);
  if (!rlp) throw new Error(`intent ${intent.intent_id} has no signed transaction`);
  return broadcast(rlp);
}
