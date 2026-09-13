import { FetchRequest, JsonRpcProvider, Transaction } from "ethers";
import { venue } from "./venue";
import { readChainOutcome, submitAndConfirm } from "./hedera-receipts";

/**
 * Hedera side of the join. Privy signs only (eth_signTransaction on chain 296); this module
 * prepares the transaction fields a desk wallet needs and broadcasts the signed RLP through the
 * Hedera JSON-RPC relay. No Hedera-native signing is required anywhere in the desk flow.
 */
export const HEDERA_RPC = process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api";
export const HASHSCAN = `https://hashscan.io/${process.env.HEDERA_NETWORK ?? "testnet"}`;

export function provider() {
  const request = new FetchRequest(HEDERA_RPC);
  request.timeout = 4000;
  return new JsonRpcProvider(request, undefined, { staticNetwork: true, cacheTimeout: -1 });
}

export async function walletNonce(address: string) {
  const p = provider();
  try { return await p.getTransactionCount(address, "pending"); }
  finally { p.destroy(); }
}

/** Nonce and fee fields for a type-2 transaction from `from` on Hedera testnet. */
export async function txFields(from: string, gasLimit = 1_000_000) {
  const p = provider();
  try {
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
  } finally { p.destroy(); }
}

const MIRROR = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

/**
 * Was this transaction mined? The relay's eth_getTransactionReceipt answers 400 for some HTS system-contract
 * calls (token association through the HIP-719 facade), so the mirror node is the authority.
 */
export async function transactionOutcome(hash: string) {
  const p = provider();
  try {
    return await readChainOutcome(hash, {
      receipt: (txHash) => p.getTransactionReceipt(txHash),
      mirror: async (txHash) => {
        const response = await fetch(`${MIRROR}/api/v1/contracts/results/${txHash}`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
        return response.ok ? await response.json() as { result?: string } : null;
      },
    });
  } finally { p.destroy(); }
}

export async function minedStatus(hash: string): Promise<0 | 1 | null> { return (await transactionOutcome(hash))?.status ?? null; }

/** Broadcast an RLP-encoded signed transaction and wait for the receipt. Idempotent for retries. */
export async function broadcast(signedRlp: string) {
  const p = provider();
  const parsed = Transaction.from(signedRlp);
  const hash = parsed.hash!;
  try {
    if (!parsed.from || !hash) throw new Error("The Privy transaction is not signed.");
    const outcome = await submitAndConfirm({ hash, from: parsed.from, nonce: parsed.nonce, signed: signedRlp }, {
      outcome: transactionOutcome,
      nonce: (address) => p.getTransactionCount(address, "pending"),
      send: (raw) => p.send("eth_sendRawTransaction", [raw]),
      pause: () => new Promise((resolve) => setTimeout(resolve, 1500)),
    });
    return { hash, from: parsed.from, to: parsed.to, ...outcome, link: `${HASHSCAN}/transaction/${hash}` };
  } finally { p.destroy(); }
}
