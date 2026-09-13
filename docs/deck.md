# SyndicateLend — short deck

Ten slides, one line of speaker notes each. Live app: <https://syndicatelend.fullmetal.finance> · Video and showcase: <https://ethglobal.com/showcase/syndicatelend-dd17h> · Full argument: [PITCH.md](../PITCH.md).

---

## 1. SyndicateLend

**A private tokenised register and RFQ secondary market for syndicated-loan interests on Hedera.** A loan trade settles as one atomic, compliance-checked transaction instead of a weeks-long reconciliation.

*Notes: built solo in five days by the founder of Fullmetal Finance (institutional collateral and settlement infrastructure), Hedera hackathon, ATS track.*

---

## 2. The problem

- US$1.5tn of loans outstanding, US$971bn traded a year, and a par trade still settles in the mid-to-high teens of business days.
- Ownership, eligibility, documents and cash live in four systems. Agreeing a price is not completing the transfer.
- Only 29% of par trades settled within T+7 in LSTA's 2021 commentary; 27% took more than T+20.

*Notes: sellers wait for proceeds, both sides carry non-performance risk, daily-redemption funds carry liquidity mismatch.*

---

## 3. What we tokenise

**The assignment itself, on the agent's register.** Not exposure to a loan behind a fund wrapper.

- One credit agreement, one ATS security per facility or tranche. 1 token = US$1 par.
- Whitelist and time-bound internal KYC on the token: a transfer to an unverified account reverts on-chain.

*Notes: tokenised private credit wraps exposure and still settles the old way behind it; we change the settlement of the underlying transfer.*

---

## 4. One workflow, five Hedera and partner services

| Step | Service |
|---|---|
| Register and eligibility | Asset Tokenization Studio |
| RFQ market, consent, receipts | HCS topics |
| Institutional approval | Privy 2-of-3 key quorums under a venue-only policy |
| Atomic delivery versus payment | `SettlementEngine` + Hedera Schedule Service (HIP-1215, contract as payer) |
| Confidential interest | Chainlink CRE confidential workflow, salted commitment on HCS, HTS payout |

*Notes: no keeper, no operator key in the settlement path; the contract schedules and pays for its own execution.*

---

## 5. Settlement that re-checks compliance at execution

- Each desk approves the hash of the full instruction. The second approval schedules `settle`.
- Both legs run inside one execution boundary: any ATS, KYC, allowance or balance failure reverts both, with the reason stored on-chain.
- Proven on testnet: trade 1 settled atomically; trade 2 failed as a whole after the buyer was revoked between approval and execution (`AccountIsBlocked(buyer)`).

*Notes: we use `transferFrom`, never `forcedTransfer`, so the compliance check cannot be bypassed.*

---

## 6. Institutional control, not a hot wallet

- Every desk wallet is owned by a Privy key quorum, threshold 2 of 3, under a policy that only allows the venue contracts on Hedera testnet.
- Named institutions: trader, compliance officer, portfolio manager. Self-service judge desks: trader, automated compliance co-signer, per-desk reserve key. The venue holds one key of three.
- The app secret alone can never move assets.

*Notes: one signature does nothing; the second executes; the venue broadcasts.*

---

## 7. Interest without publishing the rate

- The agent commits a salted hash of its private rate notice to HCS.
- Inside a CRE enclave the workflow fetches the notice, matches the hash, reads every holder's par in one `RegisterSnapshot` call and releases only who is paid what.
- A tampered notice (+25 bps) is refused and nothing is released. The paying agent settles the distribution in atomic HTS transfers, receipt on HCS.

*Notes: a 310-holder period computed in one enclave call and paid to 308 holders in 35 atomic batches; the local CRE simulator is the disclosed fallback until Confidential Workflows access.*

---

## 8. It fits the agent's systems

- Register reconciliation ingests the agent's own lender-register export, marks AGREES or BREAK per lender, and attests only a report hash on HCS.
- Every settled trade exports as an LSTA-vocabulary assignment record for the agent's loan system.
- Retail feeder holders on public Hedera, institutions on HashSphere, one transaction shape: 300 feeder accounts onboarded on testnet (1,800 transactions) and paid their interest in 35 atomic batches.

*Notes: the adoption path is a shadow register beside the agent's books, not a core-system replacement.*

---

## 9. What Hedera gains

- Value per transaction, not throughput: one agent's book puts US$120bn of par on-register, US$4bn of settlements and US$8.7bn of interest a year through the network; US$900bn on-register at Versana scale.
- Institutional cash on the ledger on every settlement and payment date.
- On-register loan positions become reusable collateral for secured funding and OTC derivatives margin, Fullmetal Finance's core business.

*Notes: labelled assumptions and the worked example are in the README's "Network impact".*

---

## 10. Validation, model and the ask

- Indian syndicated-loan institutions (ICICI Bank, HDFC Bank, SBI) have indicated interest to Fullmetal Finance; expressions of interest, not contracts.
- Model: settlement fee per trade, facility onboarding, annual register maintenance, interest-distribution fee.
- **Ask:** one agent and one investor for a one-quarter shadow-register pilot on a single facility; HashSphere guidance; Chainlink Confidential Workflows access; introductions to loan-operations practitioners.

*Notes: pilot cost to the customer is a register export and about two hours a week of operations time.*
