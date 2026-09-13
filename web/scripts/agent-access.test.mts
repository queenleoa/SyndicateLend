import assert from "node:assert/strict";
import test from "node:test";
import { platformAdminAllowed } from "../src/lib/agent";

test("hosted judges never inherit agent-bank authority from an empty allow-list", () => {
  assert.equal(platformAdminAllowed("judge", undefined, true), false);
  assert.equal(platformAdminAllowed("judge", " , ", true), false);
  assert.equal(platformAdminAllowed("judge", "agent-a, agent-b", true), false);
  assert.equal(platformAdminAllowed("agent-b", "agent-a, agent-b", true), true);
});
test("the original unrestricted fallback is limited to local development", () => {
  assert.equal(platformAdminAllowed("developer", undefined, false), true);
  assert.equal(platformAdminAllowed("developer", "agent-a", false), false);
});
