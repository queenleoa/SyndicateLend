export interface NonceIntent {
  status: string;
  expires_at?: number;
  request_details?: { body?: { method?: string; params?: { transaction?: { nonce?: number | string; chain_id?: number | string } } } };
}

/** Fill the first unreserved nonce, not highest + 1: failed future intents must not grow a gap. */
export function nextUnreservedNonce(chainNonce: number, intents: NonceIntent[], chainId: number, now = Date.now()): number {
  if (!Number.isSafeInteger(chainNonce) || chainNonce < 0) throw new Error("Hedera returned an invalid wallet nonce.");
  const reserved = new Set<number>();
  for (const intent of intents) {
    if (!["pending", "granted", "processing", "executed"].includes(intent.status)) continue;
    if (intent.status === "pending" && intent.expires_at != null && intent.expires_at <= now) continue;
    const body = intent.request_details?.body;
    if (body?.method !== "eth_signTransaction") continue;
    const tx = body.params?.transaction;
    if (!tx || Number(tx.chain_id) !== chainId) continue;
    const n = typeof tx.nonce === "string" && /^(0x[0-9a-f]+|\d+)$/i.test(tx.nonce) ? Number(tx.nonce) : tx.nonce;
    if (!Number.isSafeInteger(n) || Number(n) < 0) throw new Error("An outstanding Privy transaction has an invalid nonce. Refresh its status before proposing another approval.");
    if (Number(n) >= chainNonce) reserved.add(Number(n));
  }
  let next = chainNonce;
  while (reserved.has(next)) next++;
  return next;
}
