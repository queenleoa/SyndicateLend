import assert from "node:assert/strict";
import test from "node:test";
import { resetAllowed } from "../src/lib/reset";

test("reset is limited to the configured email group, plus-aliases included", () => {
  const list = "Adrija11235@gmail.com, judge@example.com";
  assert.equal(resetAllowed("adrija11235@gmail.com", list), true);
  assert.equal(resetAllowed("adrija11235+judge3-compliance@gmail.com", list), true);
  assert.equal(resetAllowed("JUDGE+pm@example.com", list), true);
  assert.equal(resetAllowed("someone@gmail.com", list), false);
  assert.equal(resetAllowed("adrija11235@other.com", list), false);
  assert.equal(resetAllowed(null, list), false);
  assert.equal(resetAllowed("adrija11235@gmail.com", undefined), false);
  assert.equal(resetAllowed("adrija11235@gmail.com", ""), false);
});
