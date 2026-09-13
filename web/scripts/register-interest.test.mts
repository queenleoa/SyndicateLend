import { test } from "node:test";
import assert from "node:assert/strict";
import { accrualUnits, holderPayoutLink, sumReleasedAmounts, type RegisterPayout } from "../src/lib/register-interest";

test("each holder links to its actual payout batch, never an unpaid holder", () => {
  const payout: RegisterPayout = { commitment: "0x1", hashscan: "first", paid: [{ holder: "0xAa", amountUnits: "100" }, { holder: "0xBb", amountUnits: "200" }, { holder: "0xCc", amountUnits: "300" }], skipped: [{ holder: "0xDd", reason: "not associated" }], batches: [{ holders: 2, hashscan: "first" }, { holders: 1, hashscan: "second" }] };
  assert.equal(holderPayoutLink(payout, "0xaa"), "first");
  assert.equal(holderPayoutLink(payout, "0xcc"), "second");
  assert.equal(holderPayoutLink(payout, "0xdd"), null);
  assert.equal(holderPayoutLink(null, "0xaa"), null);
});

test("missing snapshot entry is distinct from a real zero accrual", () => {
  assert.equal(sumReleasedAmounts([]), null);
  assert.equal(sumReleasedAmounts([{ amountUnits: "0" }]), "0");
  assert.equal(sumReleasedAmounts([{ amountUnits: "9007199254740993" }, { amountUnits: "2" }]), "9007199254740995");
});

test("the agent's estimate uses the enclave's integer formula", () => {
  // 100m par at 7.25% for 30 days on a 360 basis = 604,166.666666 mUSD, rounded down to 6 dp.
  assert.equal(accrualUnits(100_000_000n, 725, 30, 360), 604_166_666_666n);
  assert.equal(accrualUnits(0n, 725, 30, 360), 0n);
});
