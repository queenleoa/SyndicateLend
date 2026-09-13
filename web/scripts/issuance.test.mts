import assert from "node:assert/strict";
import test from "node:test";
import { ZeroHash } from "ethers";
import { issuanceCap, issuanceIsin, issuanceSteps, unallocated, validateIssuanceTerms } from "../src/lib/issuance-spec";
import { BOND_CONFIG_ID, encodeLoanCreation, factoryInterface, resolveAtsAddress } from "../src/lib/issuance-contract";

const now = Date.parse("2026-09-13T12:00:00Z");
const lender = "0x00000000000000000000000000000000000000aa";
const other = "0x00000000000000000000000000000000000000bb";
const terms = { name: "Meridian Holdings Tranche C", symbol: "mhtlb-c", facilityType: "Term Loan B", principal: "30000000", maturityDate: "2031-06-30", documentRef: "ipfs://synthetic-agreement", rateBps: 725, allocations: [{ wallet: lender, par: "20000000" }, { wallet: other, par: "5,000,000" }], pauser: true, freezeManager: true, controller: false };
const agent = "0x0000000000000000000000000000000000001234";
const resolver = "0x0000000000000000000000000000000000005678";

test("loan terms are bounded, normalized and integer-valued", () => {
  const v = validateIssuanceTerms(terms, now);
  assert.equal(v.symbol, "MHTLB-C");
  assert.deepEqual(v.allocations, [{ wallet: lender, par: "20000000" }, { wallet: other, par: "5000000" }]);
  assert.equal(unallocated(v), 5_000_000n);
  for (const principal of ["0", "1.5", "1e8", "-5", "1000000001", "025000000"]) assert.throws(() => validateIssuanceTerms({ ...terms, principal, allocations: [] }, now));
  assert.equal(validateIssuanceTerms({ ...terms, principal: "1000000000" }, now).principal, "1000000000");
});

test("allocations cannot exceed the principal, repeat a lender or use a bad wallet", () => {
  assert.throws(() => validateIssuanceTerms({ ...terms, allocations: [{ wallet: lender, par: "30000001" }] }, now), /exceed/);
  assert.throws(() => validateIssuanceTerms({ ...terms, allocations: [{ wallet: lender, par: "1" }, { wallet: lender.toUpperCase().replace("0X", "0x"), par: "1" }] }, now), /twice/);
  assert.throws(() => validateIssuanceTerms({ ...terms, allocations: [{ wallet: "not-a-wallet", par: "1" }] }, now));
  assert.deepEqual(validateIssuanceTerms({ ...terms, allocations: [{ wallet: lender, par: "0" }] }, now).allocations, []);
});

test("rate, facility type and symbol collisions are validated", () => {
  for (const rateBps of [0, -1, 5001, 7.25, "abc"]) assert.throws(() => validateIssuanceTerms({ ...terms, rateBps }, now), /basis points/);
  assert.equal(validateIssuanceTerms({ ...terms, facilityType: "Not a type" }, now).facilityType, "Term Loan B");
  assert.throws(() => validateIssuanceTerms(terms, now, ["MHTLB-A", "mhtlb-c"]), /already on the register/);
});

test("maturity must be a real future calendar date", () => {
  for (const maturityDate of ["2026-09-14", "2027-02-30", "2059-01-01", "2031-13-01", "invalid"]) assert.throws(() => validateIssuanceTerms({ ...terms, maturityDate }, now));
  assert.equal(validateIssuanceTerms({ ...terms, maturityDate: "2027-02-28" }, now).maturityDate, "2027-02-28");
});

test("required controls, lengths and public references are validated server-side", () => {
  for (const patch of [{ controller: "false" }, { pauser: undefined }, { name: "a" }, { symbol: "A <>" }, { documentRef: "javascript:alert(1)" }, { name: "Private\nnotice" }]) assert.throws(() => validateIssuanceTerms({ ...terms, ...patch }, now));
  assert.equal(validateIssuanceTerms({ ...terms, documentRef: "" }, now).documentRef, "");
});

test("chain steps follow the terms: agent setup, engine, one whitelist/KYC/issue per lender, remainder, notice", () => {
  const v = validateIssuanceTerms(terms, now);
  const steps = issuanceSteps(v, { [lender]: "Northgate" });
  assert.deepEqual(steps.map((s) => s.op), ["create", "issuer", "whitelist", "kyc", "engine", "whitelist", "kyc", "issue", "whitelist", "kyc", "issue", "mint", "notice"]);
  assert.equal(steps.find((s) => s.key === `issue:${lender}`)?.amount, "20000000");
  assert.match(steps.find((s) => s.key === `issue:${lender}`)!.label, /Northgate/);
  assert.equal(steps.find((s) => s.op === "mint")?.amount, "5000000");
  const full = issuanceSteps({ ...v, allocations: [{ wallet: lender, par: v.principal }] });
  assert.equal(full.some((s) => s.op === "mint"), false);
  assert.equal(new Set(steps.map((s) => s.key)).size, steps.length);
});

test("issuance safety cap cannot silently become unlimited", () => {
  assert.equal(issuanceCap(undefined), 20);
  for (const raw of ["0", "-1", "51", "Infinity", "abc", "1.5"]) assert.equal(issuanceCap(raw), 20);
  assert.equal(issuanceCap("50"), 50);
});

test("synthetic ISIN is stable and has a valid check digit", () => {
  const isin = issuanceIsin("abc123de45");
  assert.match(isin, /^XS[A-Z0-9]{9}\d$/);
  assert.equal(isin, issuanceIsin("abc123de45"));
  const digits = isin.split("").map((c) => /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c).join("");
  let sum = 0;
  for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) { const n = Number(digits[i]) * (double ? 2 : 1); sum += n > 9 ? n - 9 : n; }
  assert.equal(sum % 10, 0);
});

test("factory calldata matches the installed ATS v8 ABI and fixed loan controls", () => {
  const normalized = validateIssuanceTerms(terms, now);
  const data = encodeLoanCreation(normalized, agent, resolver, issuanceIsin("123456789"), Math.floor(now / 1000) + 120);
  const [bond, regulation] = factoryInterface.decodeFunctionData("deployBond", data);
  assert.equal(bond.security.maxSupply, 30000000n);
  assert.equal(bond.security.erc20MetadataInfo.symbol, "MHTLB-C");
  assert.equal(bond.security.erc20MetadataInfo.decimals, 0n);
  assert.equal(bond.security.resolverProxyConfiguration.key, BOND_CONFIG_ID);
  assert.equal(bond.security.isWhiteList, true);
  assert.equal(bond.security.internalKycActivated, true);
  assert.equal(bond.security.isControllable, false);
  assert.equal(bond.security.clearingActive, false);
  assert.equal(bond.bondDetails.currency, "0x555344");
  assert.equal(bond.bondDetails.nominalValue, 1n);
  assert.equal(regulation.regulationType, 1n);
  assert.equal(bond.security.rbacs[0].role, ZeroHash);
  assert.equal(bond.security.rbacs.length, 9);
  assert.equal(bond.security.rbacs.every((r: { members: string[] }) => r.members.length === 1 && r.members[0].toLowerCase() === agent), true);
});

test("ATS ids resolve through the mirror node to their canonical EVM alias", async () => {
  const alias = "0x" + "ab".repeat(20);
  const fetcher = (async () => ({ ok: true, json: async () => ({ contract_id: "0.0.9213391", evm_address: alias }) })) as unknown as typeof fetch;
  assert.equal((await resolveAtsAddress("0.0.9213391", "https://mirror", fetcher)).toLowerCase(), alias);
  assert.equal((await resolveAtsAddress("0x" + "cd".repeat(20), "https://mirror", fetcher)).toLowerCase(), "0x" + "cd".repeat(20));
  const wrong = (async () => ({ ok: true, json: async () => ({ contract_id: "0.0.1", evm_address: alias }) })) as unknown as typeof fetch;
  await assert.rejects(() => resolveAtsAddress("0.0.9213391", "https://mirror", wrong));
});
