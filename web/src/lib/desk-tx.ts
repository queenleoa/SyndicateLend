import { privy } from "./privy-server";
import { txFields, broadcast } from "./hedera";
import { venue } from "./venue";
import { trades } from "./trades";

/**
 * Desk-wallet transactions: proposed as Privy intents (quorum-approved), executed by Privy as a
 * signed RLP transaction, then broadcast to Hedera by the venue service.
 */

/** Nonce for a desk wallet: relay's pending nonce plus intents already executed but not yet broadcast. */
async function nextNonce(wallet: string) {
  const fields = await txFields(wallet);
  const pending = trades
    .read()
    .trades.flatMap((t) => [t.approvals.seller, t.approvals.buyer])
    .filter((a) => a.wallet.toLowerCase() === wallet.toLowerCase() && !a.txHash && a.intentStatus !== "rejected" && a.intentStatus !== "expired").length;
  return { ...fields, nonce: fields.nonce + pending };
}

export async function proposeDeskTx(input: { walletId: string; walletAddress: string; to: string; data: string; gasLimit?: number; extraPendingNonce?: number }) {
  const fields = await nextNonce(input.walletAddress);
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
