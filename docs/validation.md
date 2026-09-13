# Validation record

Format from the PRD (§9.3): **observation → evidence → decision → resulting change**. Placeholder endorsements are not recorded here. Entries are dated; where a conversation is summarised by the founder rather than documented verbatim, that is stated.

## 1. External signals

### 1.1 Indian syndicated-loan institutions (founder conversations, 2026)

- **Observation.** In conversations about Fullmetal Finance's OTC derivatives full-stack solution, syndicated-loan institutions in India, including ICICI Bank, HDFC Bank and State Bank of India, indicated interest in solutions that make syndicated loans easier to manage alongside the derivatives stack.
- **Evidence.** Founder's account of the conversations (relationship-level, not minuted for this repository). No letters of intent, pilots or commercial terms exist. These are expressions of interest and must not be presented as customers.
- **Decision.** Treat the agency desk of an Indian private-sector bank as the first-pilot profile, and design the product around the agent's register rather than a fund-token wrapper, because the agent is the party who can actually run a shadow register.
- **Resulting change.** PRD §2.6 (India as a second market), §10.1 and §10.6 (pilot target profile and what a shadow-register pilot costs the customer); Lean Canvas customer segment and channels.

## 2. Engineering validation on testnet (evidence-driven design changes)

| Date | Observation | Evidence | Decision and change |
|---|---|---|---|
| 2026-09-10 | The network fires a schedule at its expiry second, but the EVM block timestamp can lag it by a fraction, so `settle` reverted as "too early" on the first engine deployment. | Engine `0.0.10459674`, trade settled manually and kept as a record. | Engine schedules `settleAt + 10s`, never earlier than `settleAt`. Test added. |
| 2026-09-10 | ATS `forcedTransfer` lets an agent move tokens without compliance checks. | ATS docs and the SDK's operator paths. | Engine uses `transferFrom` so a revoked buyer causes a full revert; proven with trade 2 (`AccountIsBlocked(buyer)`). |
| 2026-09-10 | The ATS SDK's KYC grant path requires a Terminal3 verifiable credential, which a backend cannot produce. | SDK 8.0.0 `Kyc` facade. | Internal KYC grants call the diamond's `grantKyc` directly; documented in the README. |
| 2026-09-10 | Hedera's JSON-RPC relay rejects overlapping nonces from one account. | Failed deploy/verify sequence. | Ops scripts send relay transactions sequentially. |
| 2026-09-11 | A Privy EVM wallet cannot sign a native `TokenAssociateTransaction`. | Privy signs `eth_signTransaction` only. | Desk wallets associate mock USD through the HIP-719 token facade as a quorum intent. |
| 2026-09-11 | The CRE HTTP capability requires request bodies as base64 bytes, and QuickJS has no `atob`. | "invalid base64 string" in simulation. | Hand-rolled decoder in `workflow.ts`; documented in `cre/README.md`. |
| 2026-09-12 | The period-1 notice snapshot listed only Privy desk wallets, so the payout would have reached one holder. | `cre/evidence/distribution.json` for period 1. | Snapshot now unions the ops deployment's eligible lenders; period 2 covers five holders. |
| 2026-09-12 | A 30-holder commitment message exceeded HCS's 1,024-byte limit and arrived as two chunks; the enclave read half a JSON document. | Period-3 commitment at HCS #5–6. | Workflow and payout script reassemble chunked messages by initial transaction id. |
| 2026-09-12 | Thirty per-holder balance reads exceeded the CRE simulator's per-execution HTTP call limit. | `LimitExceeded ... http-actions.SendRequest`. | Deployed `RegisterSnapshot` (one call returns every holder's balance); the enclave now makes three requests per period regardless of holder count. Two Foundry tests added. |
| 2026-09-12 | HTS caps token-transfer entries per transaction, so a 28-holder payout cannot be one transaction. | Payout for period 3. | Payout batches up to nine credits per atomic transaction; four batches, receipt at HCS #8. ATS Mass Payout remains the production path. |
| 2026-09-13 | Privy refuses to change a key quorum's membership with the app secret (needs current members' signatures), so judges cannot be admitted to an existing desk automatically. | `401 No valid authorization keys or user signing keys available`. | Self-service desks: a new email gets its own institution with the `+compliance` and `+pm` aliases of the same inbox as the other quorum members; an automated liquidity desk with a two-key server-held quorum provides the counterparty. |
| 2026-09-13 | The tranche's 250,000,000 units were fully issued, so allocating an opening position to a new desk reverted. | `getMaxSupply() == totalSupply()`. | Agent granted itself `CAP_ROLE` and raised the maximum supply to 1,000,000,000 (`ops/src/raise-cap.ts`). |
| 2026-09-13 | The standing cash authorisation approved 2^256-1 on the mock-USD facade and reverted after burning 98% of its gas: HTS allowances are int64. | Reverted transaction at nonce 2 of the automated desk. | Cash authorisation now approves the int64 maximum; onboarding re-proposes any desk step whose transaction reverted and treats a desk as ready only with clean receipts. |
| 2026-09-13 | A retried broadcast of an executed intent hit the relay's "nonce has already been used" and the step lost its receipt. | Automated desk onboarding log. | `broadcast()` is idempotent: it looks up the receipt of the signed transaction's hash before and after sending. |
| 2026-09-13 | Judge desks provisioned as trader + co-signer read as a 2-of-2 quorum, and a 2-of-2 with one venue key is a weaker story than the named institutions' 2-of-3. | Institution page approval-policy card. | Judge desks are now a genuine Privy 2-of-3: trader, automated compliance co-signer, and a reserve P-256 key minted per desk whose private half is discarded, so the venue holds one key of three. |
| 2026-09-13 | The payout record for Tranche A period 3 kept stale skip reasons after the distribution was recomputed (Halcyon had gained par, Meridian had associated mock USD), so the register showed "no par" and "not associated" for holders that were now payable. | `cre/evidence/payout.json` vs `cre/evidence/distributions/MHTLB-A.json`. | Payout evidence is per asset (`payouts/<SYMBOL>.json`); `--catch-up` pays only the holders an earlier run skipped and merges them into the period's receipt; the UI maps skip reasons to short labels. |
| 2026-09-13 | The automated buyer's approval was stuck at nonce 7 with nonce 8 queued behind it: the relay refused it with `Insufficient funds for transfer` because the wallet (5.3 HBAR) could not reserve gasLimit × maxFee (about 6 HBAR), and the app reported the refusal as "pending". | Aldgate wallet `0.0.10507254`, trades 6 and 7. | The market tick tops any desk wallet under 8 HBAR up with 20 HBAR from the operator; the relay's insufficient-funds rejection is reported as such (`InsufficientGasFunds`) instead of as a pending transaction. |

## 3. Practitioner review (open)

Target from the PRD: three loan-market or operations practitioners, five structured test-user responses, two changes from feedback. **Status: not yet met.** The review packet, scored questionnaire and outreach message are in [practitioner-review.md](practitioner-review.md); the open design questions are in PRD §11. Answers will be recorded here in the same format as above, with the reviewer's role (not name) and date.

| Reviewer role | Date | Observation | Evidence | Decision | Change |
|---|---|---|---|---|---|
| | | | | | |

## 4. Integration partner conversations

Chainlink Confidential Workflows is in private beta. The founder has requested enrolment for SyndicateLend (request submitted; no response recorded as of 2026-09-12). Once granted, the accrual workflow moves from the local simulator to a deployed enclave with no code change beyond deployment configuration. ATS and Privy were integrated from their public documentation and SDKs only; Access for HashSphere requested.
