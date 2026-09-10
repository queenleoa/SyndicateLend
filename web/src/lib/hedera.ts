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

/** Broadcast an RLP-encoded signed transaction and wait for the receipt. */
export async function broadcast(signedRlp: string) {
  const p = provider();
  const parsed = Transaction.from(signedRlp);
  const res = await p.broadcastTransaction(signedRlp);
  const receipt = await res.wait();
  return { hash: res.hash, from: parsed.from, to: parsed.to, status: receipt?.status ?? null, link: `${HASHSCAN}/transaction/${res.hash}` };
}
