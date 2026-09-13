import { privy } from "./privy-server";
import { txFields, broadcast } from "./hedera";
import { venue } from "./venue";
import { trades } from "./trades";

/**
 * Desk-wallet transactions: proposed as Privy intents (quorum-approved), executed by Privy as a
 * signed RLP transaction, then broadcast to Hedera by the venue service.
 */

/**
 * Nonce for a desk wallet: the relay's pending nonce, or one past the highest nonce among this wallet's
 * intents that are still pending or executed-but-not-yet-mined. Reading the wallet's own intents keeps
 * two proposals from ever sharing a nonce, whatever the venue's records say.
 */
async function nextNonce(walletId: string, wallet: string) {
  const fields = await txFields(wallet);
  let next = fields.nonce;
  try {
    const page = await privy().intents().list({ resource_id: walletId, sort_by: "created_at_desc", limit: 50 } as never);
    for (const it of page.getPaginatedItems() as unknown as { status: string; request_details?: { body?: { params?: { transaction?: { nonce?: number } } } } }[]) {
      const n = it.request_details?.body?.params?.transaction?.nonce;
      if (typeof n !== "number") continue;
      if (it.status === "pending" || (it.status === "executed" && n >= fields.nonce)) next = Math.max(next, n + 1);
    }
  } catch {
    // Fall back to the venue's own count of unbroadcast approvals.
    const pending = trades.read().trades.flatMap((t) => [t.approvals.seller, t.approvals.buyer]).filter((a) => a.intentId && a.wallet.toLowerCase() === wallet.toLowerCase() && !a.txHash && a.intentStatus !== "rejected" && a.intentStatus !== "expired").length;
    next = fields.nonce + pending;
  }
  return { ...fields, nonce: next };
}

export async function proposeDeskTx(input: { walletId: string; walletAddress: string; to: string; data: string; gasLimit?: number; extraPendingNonce?: number }) {
  const fields = await nextNonce(input.walletId, input.walletAddress);
  const tx = {
    to: input.to,
    data: input.data,
    value: "0x0",
    chain_id: venue().chainId,
    type: 2,
    nonce: fields.nonce + (input.extraPendingNonce ?? 0),
    gas_limit: input.gasLimit ?? fields.gas_limit,
    max_fee_per_gas: fields.max_fee_per_gas,
    max_priority_fee_per_gas: fields.max_priority_fee_per_gas,
  };
  const intent = await privy().intents().rpc(input.walletId, { method: "eth_signTransaction", params: { transaction: tx } } as never);
  return intent as unknown as { intent_id: string; status: string; authorization_details: { threshold: number; members: { signed_at: number | null }[] }[] };
}

export interface IntentView {
  intent_id: string;
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
