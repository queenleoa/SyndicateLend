import assert from "node:assert/strict";
import test from "node:test";
import { approvalKind, canApprove, notificationSummary, setupIntentMap, type ApprovalIntent } from "../src/lib/approval-notifications";

const now = 1_800_000_000_000;
function intent(id: string, overrides: Partial<ApprovalIntent> = {}): ApprovalIntent {
  return { intent_id: id, intent_type: "rpc", status: "pending", created_at: now - 1_000, expires_at: now + 60_000, authorization_details: [{ threshold: 2, members: [{ type: "user", user_id: "did:privy:alice", signed_at: null }, { type: "user", user_id: "bob", signed_at: null }, { type: "user", user_id: "carol", signed_at: null }] }], request_details: { body: {} }, ...overrides };
}

test("setup is classified only by exact recorded IDs, including replacements", () => {
  const map = setupIntentMap({ usdAssociate: { intentId: "setup-usd" }, allowLoan: { intentId: "setup-loan" }, intentHistory: [{ intentId: "expired-setup", step: "allowUsd" }] });
  assert.equal(approvalKind("setup-usd", map), "setup");
  assert.equal(approvalKind("expired-setup", map), "setup");
  assert.equal(approvalKind("setup-usd-unrelated", map), "trade");
  assert.equal(approvalKind("toString", map), "trade");
});

test("notifications omit completed, already-signed, expired and nonmember actions", () => {
  assert.equal(canApprove(intent("mine"), "alice", now), true);
  assert.equal(canApprove(intent("mine"), "did:privy:alice", now), true);
  assert.equal(canApprove(intent("not-mine"), "unrelated", now), false);
  assert.equal(canApprove(intent("expired", { expires_at: now }), "alice", now), false);
  for (const status of ["granted", "executed", "processing", "failed", "expired", "dismissed", "rejected"]) assert.equal(canApprove(intent(status, { status }), "alice", now), false);
  const signed = intent("signed"); signed.authorization_details[0].members[0].signed_at = 0;
  assert.equal(canApprove(signed, "alice", now), false);
  const quorumMet = intent("quorum-met"); quorumMet.authorization_details[0].members[1].signed_at = now - 100; quorumMet.authorization_details[0].members[2].signed_at = now - 100;
  assert.equal(canApprove(quorumMet, "alice", now), false);
});

test("counts deduplicate IDs and route setup and trade notifications separately", () => {
  const summary = notificationSummary([intent("setup"), intent("trade"), intent("trade"), intent("done", { status: "executed" })], "alice", { setup: "Enable payment receipts" }, now);
  assert.equal(summary.total, 2); assert.equal(summary.setup, 1); assert.equal(summary.trade, 1);
  assert.equal(summary.items[0].href, "/institution#intent-setup");
  assert.equal(summary.items[1].href, "/approvals#intent-trade");
  assert.equal(notificationSummary([intent("setup")], "outsider", { setup: "Setup" }, now).total, 0);
});
