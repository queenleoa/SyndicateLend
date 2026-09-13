/** Receipt checks are explicitly awaited: ethers' block subscriber can reject outside tx.wait(). */
export type ChainOutcome = { status: 0 | 1; reason?: string };
export interface ReceiptReader {
  receipt(hash: string): Promise<{ status: number | null } | null>;
  mirror(hash: string): Promise<{ result?: string } | null>;
}

export function relayRejection(error: unknown): { status: string; provisional: boolean } | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { code?: number; data?: { hederaStatus?: string; provisional?: boolean }; error?: unknown; info?: { responseBody?: string } };
  if (e.code === -32003 && e.data?.hederaStatus) return { status: e.data.hederaStatus, provisional: e.data.provisional === true };
  if (e.error) return relayRejection(e.error);
  if (e.info?.responseBody) {
    try { return relayRejection(JSON.parse(e.info.responseBody)); } catch { /* no structured relay response */ }
  }
  return null;
}

export async function readChainOutcome(hash: string, reader: ReceiptReader): Promise<ChainOutcome | null> {
  let rejection: ReturnType<typeof relayRejection> = null;
  try {
    const receipt = await reader.receipt(hash);
    if (receipt?.status === 1) return { status: 1 };
    if (receipt?.status === 0) {
      const mirror = await reader.mirror(hash).catch(() => null);
      return { status: 0, reason: mirror?.result ?? "CONTRACT_REVERT_EXECUTED" };
    }
  } catch (error) { rejection = relayRejection(error); }
  // HTS facade receipts can fail through the relay. A consensus result takes precedence.
  const mirror = await reader.mirror(hash).catch(() => null);
  if (mirror?.result) return mirror.result === "SUCCESS" ? { status: 1 } : { status: 0, reason: mirror.result };
  if (rejection && !rejection.provisional) return { status: 0, reason: rejection.status };
  return null; // Timeout, missing indexing and provisional errors are NOT confirmed failures.
}

export class PendingHederaTransaction extends Error {
  constructor(public hash: string) { super("Transaction submitted; Hedera confirmation is still pending. Check approved transactions again. No replacement approval is needed."); }
}

export class DeskNonceMismatch extends Error {
  constructor(public nonce: number, public expected: number) {
    super(`Wallet transaction nonce ${nonce} does not match Hedera's next nonce ${expected}. ${nonce > expected ? "An earlier transaction must confirm, or a failed setup approval must be replaced." : "This signed transaction is stale; its original receipt must be checked before requesting fresh approval."}`);
  }
}

export interface BroadcastIO {
  outcome(hash: string): Promise<ChainOutcome | null>;
  nonce(address: string): Promise<number>;
  send(signed: string): Promise<unknown>;
  pause(): Promise<void>;
}

/** No background subscriber, no nonce editing and no fabricated success on a missing receipt. */
export async function submitAndConfirm(tx: { hash: string; from: string; nonce: number; signed: string }, io: BroadcastIO, attempts = 3): Promise<ChainOutcome> {
  const prior = await io.outcome(tx.hash);
  if (prior) return prior;
  const expected = await io.nonce(tx.from);
  if (tx.nonce !== expected) {
    const racedReceipt = await io.outcome(tx.hash);
    if (racedReceipt) return racedReceipt;
    throw new DeskNonceMismatch(tx.nonce, expected);
  }
  let sendError: unknown;
  try { await io.send(tx.signed); } catch (error) { sendError = error; }
  for (let i = 0; i < attempts; i++) {
    const result = await io.outcome(tx.hash);
    if (result) return result;
    if (i < attempts - 1) await io.pause();
  }
  const rejection = relayRejection(sendError);
  if (rejection && !rejection.provisional) return { status: 0, reason: rejection.status };
  throw new PendingHederaTransaction(tx.hash);
}
