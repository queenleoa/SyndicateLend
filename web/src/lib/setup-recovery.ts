import type { ChainOutcome } from "./hedera-receipts";
import type { NonceIntent } from "./desk-nonce";

export const SETUP_STEPS = ["usdAssociate", "allowLoan", "allowUsd"] as const;
export type SetupStep = typeof SETUP_STEPS[number];

export function parseSetupRetry(value: unknown): { step: SetupStep; intentId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Select a failed wallet setup step.");
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !["step", "intentId"].includes(key)) || !SETUP_STEPS.includes(body.step as SetupStep) || typeof body.intentId !== "string" || !body.intentId || body.intentId.length > 150) throw new Error("Select the exact setup approval to replace.");
  return { step: body.step as SetupStep, intentId: body.intentId };
}

export function setupRecoveryDecision(status: string, hasSignedTransaction: boolean, outcome: ChainOutcome | null): "complete" | "replace" | "wait" {
  if (outcome?.status === 1) return "complete";
  if (outcome?.status === 0) return "replace";
  if (!hasSignedTransaction && ["expired", "rejected", "failed"].includes(status)) return "replace";
  return "wait"; // An ambiguous timeout or a nonce gap alone never authorises replacement.
}

export type SetupPermissionIntent = NonceIntent & { resource_id?: string; request_details?: { body?: { method?: string; params?: { transaction?: { nonce?: number | string; chain_id?: number | string; to?: string; data?: string; value?: string } } } } };

export function matchesSetupPermission(intent: SetupPermissionIntent, walletId: string, spec: { to: string; data: string }, chainId: number): boolean {
  const body = intent.request_details?.body;
  const tx = body?.params?.transaction;
  return intent.resource_id === walletId && body?.method === "eth_signTransaction" && Number(tx?.chain_id) === chainId &&
    tx?.to?.toLowerCase() === spec.to.toLowerCase() && tx?.data?.toLowerCase() === spec.data.toLowerCase() &&
    typeof tx.value === "string" && /^(0x0+|0)$/.test(tx.value);
}
