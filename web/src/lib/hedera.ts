import { JsonRpcProvider, Transaction } from "ethers";
import { venue } from "./venue";

/**
 * Hedera side of the join. Privy signs only (eth_signTransaction on chain 296); this module
 * prepares the transaction fields a desk wallet needs and broadcasts the signed RLP through the
 * Hedera JSON-RPC relay. No Hedera-native signing is required anywhere in the desk flow.
 */
export const HEDERA_RPC = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
export const HASHSCAN = `https://hashscan.io/${process.env.HEDERA_NETWORK ?? "testnet"}`;

export function provider() {
  return new JsonRpcProvider(HEDERA_RPC, undefined, { staticNetwork: true });
}

/** Nonce and fee fields for a type-2 transaction from `from` on Hedera testnet. */
export async function txFields(from: string, gasLimit = 1_000_000) {
  const p = provider();
  const [nonce, fee] = await Promise.all([p.getTransactionCount(from, "pending"), p.getFeeData()]);
  const maxFee = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  return {
    chain_id: venue().chainId,
    type: 2 as const,
    nonce,
    gas_limit: gasLimit,
    max_fee_per_gas: "0x" + maxFee.toString(16),
    max_priority_fee_per_gas: "0x" + (fee.maxPriorityFeePerGas ?? 0n).toString(16),
  };
}

const MIRROR = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

/**
 * Was this transaction mined? The relay's eth_getTransactionReceipt answers 400 for some HTS system-contract
 * calls (token association through the HIP-719 facade), so the mirror node is the authority.
 */
export async function minedStatus(hash: string): Promise<0 | 1 | null> {
  const p = provider();
  const r = await p.getTransactionReceipt(hash).catch(() => null);
  if (r) return r.status === 1 ? 1 : 0;
  const m = await fetch(`${MIRROR}/api/v1/contracts/results/${hash}`, { cache: "no-store" }).catch(() => null);
  if (!m || m.status === 404) return null;
  if (!m.ok) return null;
  const j = (await m.json()) as { result?: string };
  if (!j.result) return null;
  return j.result === "SUCCESS" ? 1 : 0;
}

/** Broadcast an RLP-encoded signed transaction and wait for the receipt. Idempotent for retries. */
export async function broadcast(signedRlp: string) {
  const p = provider();
  const parsed = Transaction.from(signedRlp);
  const hash = parsed.hash!;
  const prior = await minedStatus(hash);
  if (prior !== null) return { hash, from: parsed.from, to: parsed.to, status: prior, link: `${HASHSCAN}/transaction/${hash}` };
  try {
    const res = await p.broadcastTransaction(signedRlp);
    const receipt = await res.wait().catch(() => null);
    const status = receipt ? receipt.status : await waitMined(hash);
    return { hash: res.hash, from: parsed.from, to: parsed.to, status, link: `${HASHSCAN}/transaction/${res.hash}` };
  } catch (e) {
    if (/nonce has already been used|already known|nonce/i.test((e as Error).message)) {
      const status = await waitMined(hash, 3);
      if (status !== null) return { hash, from: parsed.from, to: parsed.to, status, link: `${HASHSCAN}/transaction/${hash}` };
    }
    throw e;
  }
}

async function waitMined(hash: string, attempts = 8): Promise<0 | 1 | null> {
  for (let i = 0; i < attempts; i++) {
    const s = await minedStatus(hash);
    if (s !== null) return s;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return null;
}
