import assert from "node:assert/strict";
import test from "node:test";
import { assignmentNeedsConsent } from "../src/lib/assignment-state";

test("hosted preparation after consent never asks the agent to approve twice", () => {
  assert.equal(assignmentNeedsConsent({ state: "PreparingApprovals", consent: { status: "granted" } }), false);
  assert.equal(assignmentNeedsConsent({ state: "AwaitingApprovals", consent: { status: "granted" } }), false);
});
test("pending and partially prepared requests still require consent, terminal requests do not", () => {
  for (const state of ["AwaitingAgentConsent", "PreparingApprovals"]) assert.equal(assignmentNeedsConsent({ state, consent: { status: "pending" } }), true);
  for (const state of ["Settled", "Failed", "Cancelled"]) assert.equal(assignmentNeedsConsent({ state, consent: { status: "pending" } }), false);
});
