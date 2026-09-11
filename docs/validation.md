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

## 3. Practitioner review (open)

Target from the PRD: three loan-market or operations practitioners, five structured test-user responses, two changes from feedback. **Status: not yet met.** The review packet, scored questionnaire and outreach message are in [practitioner-review.md](practitioner-review.md); the open design questions are in PRD §11. Answers will be recorded here in the same format as above, with the reviewer's role (not name) and date.

| Reviewer role | Date | Observation | Evidence | Decision | Change |
|---|---|---|---|---|---|
| | | | | | |

## 4. Integration partner conversations

Chainlink Confidential Workflows is in private beta. The founder has requested enrolment for SyndicateLend (request submitted; no response recorded as of 2026-09-12). Once granted, the accrual workflow moves from the local simulator to a deployed enclave with no code change beyond deployment configuration. ATS and Privy were integrated from their public documentation and SDKs only; no partner conversations are recorded.
