import assert from "node:assert/strict";
import test from "node:test";
import { nextUnreservedNonce, type NonceIntent } from "../src/lib/desk-nonce";
import { readChainOutcome, relayRejection, submitAndConfirm, PendingHederaTransaction, DeskNonceMismatch, type BroadcastIO } from "../src/lib/hedera-receipts";
import { matchesSetupPermission, parseSetupRetry, setupRecoveryDecision, type SetupPermissionIntent } from "../src/lib/setup-recovery";
import { supersededSetupIntentIds, canApprove, type ApprovalIntent } from "../src/lib/approval-notifications";

const intent = (nonce: number | string, status = "executed", chain_id = 296): NonceIntent => ({ status, request_details: { body: { method: "eth_signTransaction", params: { transaction: { nonce, chain_id } } } } });
const wrongNonce = { code: "UNKNOWN_ERROR", error: { code: -32003, message: "Transaction rejected: WRONG_NONCE", data: { hederaStatus: "WRONG_NONCE" } } };

test("regression: failed step 7 at nonce 4 cannot force expected nonce 3 to become 5", () => {
  assert.equal(nextUnreservedNonce(3, [intent(0), intent(1), intent(2), intent(4)], 296), 3);
  assert.equal(nextUnreservedNonce(3, [intent(3, "pending"), intent(4)], 296), 5);
});

test("nonce reservations understand hex, pending execution, expiry and chain isolation", () => {
  assert.equal(nextUnreservedNonce(3, [intent("0x3", "granted"), intent(4, "processing")], 296), 5);
  assert.equal(nextUnreservedNonce(3, [intent(3, "rejected"), intent(3, "expired"), intent(3, "pending", 1)], 296), 3);
  assert.equal(nextUnreservedNonce(3, [{ ...intent(3, "pending"), expires_at: 10 }], 296, 11), 3);
  assert.throws(() => nextUnreservedNonce(3, [intent("invalid", "pending")], 296));
});

test("the reported ethers receipt rejection is decoded, awaited and recorded", async () => {
  assert.deepEqual(relayRejection(wrongNonce), { status: "WRONG_NONCE", provisional: false });
  assert.deepEqual(await readChainOutcome("hash", { receipt: async () => { throw wrongNonce; }, mirror: async () => null }), { status: 0, reason: "WRONG_NONCE" });
  assert.deepEqual(relayRejection({ info: { responseBody: JSON.stringify(wrongNonce) } }), { status: "WRONG_NONCE", provisional: false });
});

test("mirror consensus success wins over a relay rejection and HTS receipt errors", async () => {
  assert.deepEqual(await readChainOutcome("hash", { receipt: async () => { throw wrongNonce; }, mirror: async () => ({ result: "SUCCESS" }) }), { status: 1 });
  assert.deepEqual(await readChainOutcome("hash", { receipt: async () => null, mirror: async () => ({ result: "WRONG_NONCE" }) }), { status: 0, reason: "WRONG_NONCE" });
});

test("provisional timeout and unavailable receipts remain pending, never reverted", async () => {
  const provisional = { code: -32003, data: { hederaStatus: "UNKNOWN", provisional: true } };
  assert.equal(await readChainOutcome("hash", { receipt: async () => { throw provisional; }, mirror: async () => null }), null);
  assert.equal(await readChainOutcome("hash", { receipt: async () => { throw new Error("offline"); }, mirror: async () => { throw new Error("offline"); } }), null);
});

const tx = { hash: "hash", from: "wallet", nonce: 3, signed: "same-signed-bytes" };
const io = (override: Partial<BroadcastIO> = {}): BroadcastIO => ({ outcome: async () => null, nonce: async () => 3, send: async () => "hash", pause: async () => {}, ...override });

test("broadcast checks the original receipt before sending and never edits signed bytes", async () => {
  let sends = 0, reads = 0;
  const deps = io({ outcome: async () => ++reads > 1 ? { status: 1 } : null, send: async (raw) => { sends++; assert.equal(raw, tx.signed); } });
  assert.deepEqual(await submitAndConfirm(tx, deps), { status: 1 });
  assert.equal(sends, 1);
  assert.deepEqual(await submitAndConfirm(tx, io({ outcome: async () => ({ status: 1 }), send: async () => { throw new Error("must not rebroadcast"); } })), { status: 1 });
});

test("future and stale nonces never reach the relay; receipt races are reconciled", async () => {
  for (const nonce of [2, 4]) await assert.rejects(submitAndConfirm({ ...tx, nonce }, io({ send: async () => { assert.fail("wrong nonce broadcast"); } })), DeskNonceMismatch);
  let reads = 0;
  assert.deepEqual(await submitAndConfirm(tx, io({ nonce: async () => 4, outcome: async () => ++reads > 1 ? { status: 1 } : null })), { status: 1 });
});

test("receipt rejection after submission resolves without a background poller or unhandled rejection", async () => {
  let reads = 0;
  const deps = io({ outcome: async () => ++reads === 1 ? null : readChainOutcome(tx.hash, { receipt: async () => { throw wrongNonce; }, mirror: async () => null }) });
  assert.deepEqual(await submitAndConfirm(tx, deps), { status: 0, reason: "WRONG_NONCE" });
  await assert.rejects(submitAndConfirm(tx, io(), 2), PendingHederaTransaction);
  await assert.rejects(submitAndConfirm(tx, io({ send: async () => { throw new Error("transport timeout"); } }), 2), PendingHederaTransaction);
});

test("recovery requires confirmed failure and fresh approvals; pending transactions are preserved", () => {
  assert.equal(setupRecoveryDecision("executed", true, { status: 0, reason: "WRONG_NONCE" }), "replace");
  assert.equal(setupRecoveryDecision("executed", true, { status: 1 }), "complete");
  assert.equal(setupRecoveryDecision("executed", true, null), "wait");
  assert.equal(setupRecoveryDecision("pending", false, null), "wait");
  assert.equal(setupRecoveryDecision("expired", false, null), "replace");
  assert.equal(setupRecoveryDecision("expired", true, null), "wait");
});

test("recovery requests bind to one exact step and intent, never custom nonce/amount/wallet", () => {
  assert.deepEqual(parseSetupRetry({ step: "allowUsd", intentId: "reviewed-intent" }), { step: "allowUsd", intentId: "reviewed-intent" });
  for (const body of [null, {}, { step: "fund", intentId: "x" }, { step: "allowUsd", intentId: "x", nonce: 3 }, { step: "allowUsd", intentId: "x", institution: "someone-else" }]) assert.throws(() => parseSetupRetry(body));
});

test("recovery may adopt only the same wallet, chain, target, calldata and zero value", () => {
  const spec = { to: "0xAbCd", data: "0x123456" };
  const candidate: SetupPermissionIntent = {
    status: "pending", resource_id: "own-wallet",
    request_details: { body: { method: "eth_signTransaction", params: { transaction: { nonce: 3, chain_id: 296, to: "0xabcd", data: spec.data, value: "0x0" } } } },
  };
  assert.equal(matchesSetupPermission(candidate, "own-wallet", spec, 296), true);
  assert.equal(matchesSetupPermission(candidate, "someone-else", spec, 296), false);
  assert.equal(matchesSetupPermission(candidate, "own-wallet", spec, 1), false);
  for (const override of [{ data: "0x987654" }, { to: "0xdef0" }, { value: "0x1" }]) {
    const copy = structuredClone(candidate);
    Object.assign(copy.request_details!.body!.params!.transaction!, override);
    assert.equal(matchesSetupPermission(copy, "own-wallet", spec, 296), false);
  }
});

test("superseded setup requests cannot be approved; restoring an older intent makes it current", () => {
  const previous = supersededSetupIntentIds({ allowUsd: { intentId: "nonce-3" }, intentHistory: [{ intentId: "nonce-4", step: "allowUsd" }, { intentId: "nonce-3", step: "allowUsd" }] });
  assert.deepEqual([...previous], ["nonce-4"]);
  const approval = { status: "pending", superseded: true, expires_at: Date.now() + 60_000, authorization_details: [{ threshold: 2, members: [{ type: "user", user_id: "member", signed_at: null }] }] } as ApprovalIntent;
  assert.equal(canApprove(approval, "member"), false);
  assert.equal(canApprove({ ...approval, superseded: false }, "member"), true);
});
