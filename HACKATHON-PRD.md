# SyndicateLend — Hackathon Product Requirements Document

**Product:** Private tokenised loan registry and secondary exchange

**Track:** Tokenisation of Anything — Asset Tokenization Studio

**Integrations:** Hedera ATS, Hedera Token Service, Hedera Consensus Service, Hedera Scheduled Transactions, Privy and Chainlink CRE

**Network:** Hedera testnet

**Team:** Solo founder (Adrija, founder of Fullmetal Finance)

**Build window:** Five days

---

## 1. Executive Summary

When a company needs to borrow more than one bank is willing to provide, several banks lend together under one credit agreement. This is a syndicated loan.

Syndicated loans form one of the world's largest credit markets. The Morningstar LSTA Leveraged Loan Index was approaching **$1.5 trillion** in outstanding loans in 2025. US secondary loan trading reached a record **$971 billion in 2025**, and trailing twelve-month volume passed **$1 trillion in the first quarter of 2026**.

Yet a loan interest is not transferred like a listed security. It is a contractual claim governed by a private credit agreement. The administrative agent maintains the lender register, the parties exchange assignment documents, eligibility and consent conditions must be satisfied, and the cash and asset legs are coordinated across separate systems. A trade can be agreed quickly while its legal and operational settlement takes days or weeks.

This delay creates avoidable counterparty exposure, traps capital and generates reconciliation work. The market even uses delayed-compensation rules to allocate interest and cost of carry when settlement misses the expected date.

I am building **SyndicateLend** to address this settlement problem. It is a private, tokenised register and request-for-quote (RFQ) exchange for syndicated loan interests. Hedera Asset Tokenization Studio (ATS) represents eligible ownership, a settlement contract exchanges the loan token and payment atomically, Privy applies institutional approval controls, and Chainlink CRE calculates interest from confidential loan terms.

### Founder and origin

I am the founder of **Fullmetal Finance**, which builds collateral and settlement-efficiency products for institutional finance, including a full-stack OTC derivatives solution covering trade capture, collateral, margining and settlement. SyndicateLend applies the same settlement discipline to syndicated loans.

The idea did not come from a tokenisation trend. In conversations about Fullmetal's OTC derivatives stack, syndicated-loan institutions in India, including **ICICI Bank, HDFC Bank and State Bank of India**, indicated interest in solutions that make syndicated loans easier to manage alongside the derivatives stack. Those signals are recorded in [docs/validation.md](docs/validation.md). They are expressions of interest, not contracts, and this document does not present them as customers.

A one-page pitch is in [PITCH.md](PITCH.md) and a Lean Canvas in [docs/lean-canvas.md](docs/lean-canvas.md).

### Product thesis

> A loan trade should not remain exposed for weeks after the buyer and seller have agreed its terms. If ownership, eligibility and payment are represented on a shared ledger, the trade can settle as one controlled transaction.

### Hackathon objective

Demonstrate the complete lifecycle of one tokenised term-loan tranche:

1. issue and allocate the loan token;
2. onboard eligible lenders;
3. negotiate a trade through an RFQ;
4. collect each institution's internal approvals;
5. settle the asset and payment together;
6. calculate and distribute interest; and
7. preserve an auditable record of every material event.

---

## 2. Problem and Market Context

### 2.1 How the market works today

An administrative agent acts as the operational centre of a syndicated facility. It maintains the lender register, circulates notices, processes assignments and distributes principal and interest. Trading is bilateral: a buyer and seller agree the economics, then complete the documentation and operational steps required by the credit agreement.

```mermaid
flowchart LR
    A[Trade agreed] --> B[Eligibility and consent checks]
    B --> C[Assignment documents]
    C --> D[Agent and counterparty reconciliation]
    D --> E[Cash transfer]
    E --> F[Register updated]
    F --> G[Trade settled]

    classDef delay fill:#fff3cd,stroke:#9a6700,color:#3d2c00
    class B,C,D,E,F delay
```

These steps are not unnecessary in themselves. The inefficiency comes from performing them across fragmented records, documents and payment rails without one shared settlement state.

### 2.2 Core problems

| Problem | Operational effect | Economic effect |
|---|---|---|
| Fragmented ownership records | Parties reconcile their positions against the agent's register | Disputes and manual exceptions |
| Separate asset and cash movements | One leg may be ready before the other | Counterparty and principal risk during settlement |
| Repeated eligibility checks | KYC, transfer restrictions and consents are reviewed for each assignment | Longer settlement and higher operating cost |
| Private interest terms | Each party calculates and reconciles accrual independently | Payment breaks and delayed-compensation claims |
| Scattered audit evidence | Messages, approvals, documents and receipts live in different systems | Slow investigation and weak real-time oversight |

For loan funds offering daily redemptions, slow settlement also creates a **liquidity mismatch**: investors can request cash daily while loan-sale proceeds arrive weeks later. Cash buffers and credit lines bridge the gap but tie up capital or add funding costs, with greater pressure when redemptions rise.

The problem is therefore not that the market lacks software. ClearPar routes documents and signatures; Loan IQ supports the agent's servicing books; Versana distributes agent-sourced data. They improve coordination without making the ownership record and cash payment one transaction. Three dependencies remain:

- **Trade agreement is not lender-of-record status.** The buyer and seller agree economics first; the agent must process the assignment and record the new lender separately.
- **Eligibility is facility-specific.** KYC and tax onboarding do not replace checks against a loan's disqualified-lender list or its borrower and agent consent requirements. A complete document package can still wait in an agent's queue or a contractual consent window.
- **Cash and servicing run on separate timelines.** Bank wires must be coordinated with assignment effectiveness, while interest-payment cut-offs can interrupt transfers. During the gap, parties reconcile positions and accrued interest, including delayed compensation where applicable.

Tokenisation can connect the register, transfer checks and payment; it cannot remove contractual consent periods or make a shadow register legally authoritative by itself.

### 2.3 Evidence of demand

**Only 29% of par loan trades settled within T+7; 27% took longer than T+20**, according to LSTA's 2021 settlement commentary. These are historical figures, not a 2026 market estimate; T+n counts business days after the trade date. [Source: LSTA, Risk Management 101](https://www.lsta.org/university/operations/).

![Historical par loan settlement: 29% within seven business days, 44% in eight to twenty days, and 27% beyond twenty days.](docs/assets/loan-settlement-times.svg)

- The LSTA reported **$971 billion** of secondary loan trading in 2025, a record and 18% above 2024.
- LSTA's April 2025 settlement review showed mean and median par settlement times still in the mid-to-high teens in business days, against a ten-year average of 20 business days.
- Versana reported more than 1,500 facilities and approximately $900 billion of commitments on its agent-connected data platform, showing institutional demand for shared loan infrastructure.
- Galaxy's $75 million tokenised CLO closing in January 2026 shows growing institutional interest in on-chain credit, although it tokenises CLO securities rather than the underlying syndicated loan assignments addressed here.

### 2.4 Target users

| User | Job to be done | Current pain |
|---|---|---|
| Credit fund or CLO trading desk | Buy and sell loan interests | Uncertain settlement date and trapped liquidity |
| Loan operations team | Complete assignments and reconcile cash | Manual follow-up and exception management |
| Administrative agent | Maintain the authoritative lender register | Re-keying, consent checks and fragmented instructions |
| Compliance officer | Approve eligible counterparties and transfers | Controls sit outside the transfer itself |
| Insurer or pension investor | Hold and occasionally trade loans | Repeated onboarding and limited position visibility |
| Auditor or regulator | Reconstruct ownership and transaction history | Evidence is distributed across several systems |

### 2.5 Why this is more than tokenised private credit

Tokenised private credit already exists: Maple and Centrifuge tokenise pool or fund exposure, Figure tokenises consumer-loan assets and their financing, and Galaxy's tokenised CLO puts a securitised note on-chain. Judges should not read SyndicateLend as another instance of that category. Those products tokenise a **wrapper around loan exposure**; the underlying loan interest still changes hands through the agent's register, assignment documents and a separate cash rail. SyndicateLend tokenises the **assignment itself** at the register level and makes the settlement of that assignment atomic and compliance-aware.

| Dimension | Tokenised private credit and CLO tokens | SyndicateLend |
|---|---|---|
| What the token represents | A share of a pool, fund or securitised note | A defined par amount of one tranche on the facility's lender register |
| Who maintains the record | The issuer of the wrapper | The administrative agent, the party that already owns the register |
| Secondary transfer | Token move; the loan behind it is untouched | The assignment is the transfer; the agent's register is the token balance |
| Eligibility | Checked at issuance or by an allow-list | Re-checked inside the settlement execution; revocation causes a full revert |
| Cash leg | Off-chain, or a stablecoin transfer with no linkage | Same transaction as the asset leg; both succeed or both revert |
| Institutional authority | One wallet, one signer | User-bound quorum wallets; the venue cannot move a desk's assets |
| Interest | Computed by the issuer, published or not | Computed from confidential terms in a TEE against a public commitment; only the distribution is released |
| Timing | Immediate, or off-platform | Scheduled by the network at the agreed settlement date from inside the contract |

The result is a product an administrative agent can run as a shadow register beside its books, which is the only realistic adoption path for an asset whose legal transfer is governed by a credit agreement.

### 2.6 India as a second market

Fullmetal Finance's institutional relationships are concentrated in India, where large corporate borrowing is dominated by consortium and multiple-banking arrangements led by the same banks that expressed interest above. Secondary trading of those loans is nascent by comparison with the US market. The Secondary Loan Market Association (SLMA) was incorporated in August 2020 by ten banks, including SBI, ICICI Bank and HDFC Bank, on the recommendation of a Reserve Bank of India task force, as a self-regulatory body to develop that market through standard documents and trading rules. A settlement layer that starts from the lead bank's register, rather than from a fund wrapper, fits that market's structure. Market-size figures for India are deliberately absent from this document until they can be cited from SLMA or Reserve Bank of India data.

---

## 3. Product Definition

### 3.1 Proposed solution

SyndicateLend provides a shared register and an RFQ-based secondary market for a tokenised loan tranche.

An **assignment** makes the buyer a lender of record with direct rights under the credit agreement. A **participation** instead passes through the economics while the seller remains the registered lender; the participant also takes exposure to the seller. The core product targets assignments. Feeder interests are a separate pass-through layer, not direct lender-of-record positions in the underlying facility.

Each ATS token represents a defined amount of principal in one tranche. For the demonstration, one token represents one US dollar of par value. The token is not intended to replace the credit agreement by itself; the legal documents must recognise the digital register and define what the token represents. The first production pilot would therefore run as a shadow register before any legally binding migration.

Only verified institutions may hold or receive the token. Once a trade is agreed and approved, the `SettlementEngine` transfers the loan token from seller to buyer and the permissioned mock-USD token from buyer to seller in one contract call. If either leg or any compliance check fails, the entire transaction reverts.

### 3.2 Value proposition

SyndicateLend is designed to reduce the interval between trade agreement and settlement from weeks to a configurable T+1 or T+0 process, while retaining the controls expected in institutional credit markets.

It does this by making four elements part of the same workflow:

- **ownership:** the ATS token balance records the digital position;
- **eligibility:** KYC and transfer rules are checked when ownership moves;
- **payment:** the asset and cash legs execute atomically; and
- **evidence:** RFQs, approvals and settlement receipts form a linked audit trail.

### 3.3 Why a shared ledger is appropriate

A conventional shared database could improve coordination, but its operator would still control the definitive record and cash would remain on a separate rail. Here, the ledger is useful for a narrower reason: both the asset and payment can be authorised, checked and transferred within one verifiable execution.

Hedera is suited to the prototype because it provides:

- ATS contracts and tooling for compliant security-token issuance;
- EVM smart contracts for the atomic settlement instruction;
- native HTS controls for the mock cash token;
- HCS timestamps and ordering for the audit trail; and
- Scheduled Transactions for deferred execution and signature collection.

### 3.4 Product principles

- Follow the market's existing RFQ structure; do not introduce a public order book.
- Keep legal and compliance controls explicit rather than treating token ownership as automatically sufficient.
- Use familiar terms in the interface: par, price, counterparty, approval and settlement date.
- Expose a receipt for every material action.
- Make privacy a deployment requirement, not an afterthought.
- Present testnet activity as a technical demonstration, not as a legally effective loan transfer.

### 3.5 What is new here

Five things in this build are, to my knowledge, not found together on Hedera or in the cross-chain comparables:

1. **In-contract scheduling with the contract as payer.** `SettlementEngine` calls the Hedera Schedule Service system contract (HIP-1215 `scheduleCall`) itself when the second approval lands, and funds the scheduled execution from its own balance. No off-chain scheduler or keeper.
2. **Revocation triggers a full revert at execution time.** The compliance officer can revoke a buyer after both desks have approved; the scheduled settlement then fails as a whole, with the ATS revert reason stored on the trade. The engine uses `transferFrom` rather than ATS `forcedTransfer` precisely so that this check cannot be bypassed.
3. **Commitment-verified confidential accrual.** The agent commits a salted hash of the private rate notice to HCS; a Chainlink CRE confidential workflow verifies the notice inside a TEE and releases only the per-holder distribution. A tampered notice aborts before any output leaves the enclave.
4. **User-bound institutional quorum.** Each desk wallet is owned by a Privy key quorum with a 2-of-3 policy limited to the venue contracts: three named staff for a named institution, or the trader, the venue's automated compliance co-signer and a per-desk reserve key for a self-service judge desk (the venue holds one key of three). The application secret alone cannot move a desk's assets.
5. **The market's own workflow.** RFQ rather than an order book, an agent-centred register rather than a fund wrapper, and settlement receipts that map to the LSTA trade lifecycle desks already run.
6. **Integration hooks into the agent's existing systems.** A reconciliation adapter ingests the agent's own register export (the shape a Loan IQ book or a Versana feed produces), marks each lender AGREES or BREAK against the ATS register, computes the agreement rate and attests only a hash of the report on HCS; an assignment exporter turns settled trades into LSTA-vocabulary records for the agent's loan system or a ClearPar-style workflow. The shadow-register pilot therefore requires no re-keying on either side.

---

## 4. User Journeys

### 4.1 Issue a facility token

1. The administrative agent creates a token for one term-loan tranche through ATS.
2. The agent records the token-to-facility mapping and governing-document reference.
3. Approved institutions complete simulated KYC and are added to the identity and eligibility controls.
4. The agent allocates tokens in proportion to each lender's opening principal position.
5. The application proves the restriction by rejecting a transfer to an unverified account.

### 4.2 Trade and settle a loan interest

```mermaid
sequenceDiagram
    autonumber
    participant S as Seller desk
    participant M as RFQ service / HCS
    participant B as Buyer desk
    participant P as Privy policy
    participant E as SettlementEngine
    participant H as Hedera schedule
    participant L as ATS loan token
    participant C as HTS mock USD

    S->>M: Publish RFQ
    B->>M: Submit quote
    S->>M: Accept quote
    M->>E: Create settlement instruction
    S->>P: Request seller approval
    B->>P: Request buyer approval
    P->>E: Submit authorised approvals
    E->>H: Schedule settle(tradeId)
    H->>E: Execute on settlement date
    E->>L: Transfer loan tokens
    E->>C: Transfer payment
    Note over E,C: One transaction: both legs succeed or both revert
    E-->>M: Publish settlement receipt
```

The settlement instruction contains the facility, buyer, seller, par amount, price, cash amount, currency, settlement date and a reference to the accepted RFQ. It contains no confidential document text.

Before settlement, the application checks that:

- both parties approved the same instruction;
- the seller still owns and has authorised the required loan tokens;
- the buyer has sufficient authorised mock USD;
- the buyer remains eligible to hold the tranche; and
- the trade has not expired, settled or been cancelled.

### 4.3 Calculate and distribute interest

Floating-rate loans reset their interest rates, while secondary trades change lender positions. Each distribution therefore needs the applicable rate, accrual period and ownership record to determine who receives what. The demo links a private rate notice to a holder snapshot, making confidential calculation part of loan servicing rather than an isolated privacy feature.

The agent's rate notice may include private economics. The public testnet should not receive the notice itself. Instead, the agent commits to the notice by publishing a salted hash. Chainlink CRE retrieves the confidential data inside a trusted execution environment, verifies it against the commitment and calculates the amounts due.

```mermaid
sequenceDiagram
    autonumber
    participant A as Administrative agent
    participant T as HCS commitment topic
    participant R as CRE relayer
    participant C as Chainlink CRE TEE
    participant N as Mirror node
    participant D as InterestDistributor
    participant P as Paying agent
    participant H as Holders

    A->>A: Hash notice with random nonce
    A->>T: Publish hash and period reference
    R->>C: Trigger workflow with topic and sequence
    C->>A: Fetch notice and nonce securely
    C->>N: Read committed hash and holder snapshot
    C->>C: Verify hash and calculate accrual
    C-->>R: Return attested distribution output
    R->>D: Submit output and evidence
    P->>D: Authorise payment
    D->>H: Distribute HTS mock USD

    Note over A,C: Spread, day-count terms and nonce remain confidential
```

For the hackathon, the workflow must prove that a changed notice fails verification. Production report verification and the final Hedera delivery path remain subject to the exact CRE network and attestation interfaces available during implementation.

---

## 5. Functional Requirements

### 5.1 Priority definitions

- **P0:** required for the end-to-end demonstration;
- **P1:** include if the P0 path is stable; and
- **Later:** intentionally outside the five-day build.

### 5.2 MVP requirements

| ID | Priority | Requirement | Acceptance test |
|---|---|---|---|
| FR-01 | P0 | Issue one ATS ERC-3643 token for a term-loan tranche | Token and issuance transaction are visible on HashScan |
| FR-02 | P0 | Register at least three eligible lenders | Eligible lenders can receive; an unverified account cannot |
| FR-03 | P0 | Issue a KYC-gated HTS mock-USD token | Transfer to an account without KYC fails |
| FR-04 | P0 | Create, quote and accept an RFQ | Each event appears in order with a consensus timestamp |
| FR-05 | P0 | Apply a 2-of-3 desk approval policy through Privy | One approver cannot authorise the desk wallet; two can |
| FR-06 | P0 | Create a complete settlement instruction | Both desks see identical immutable trade economics |
| FR-07 | P0 | Schedule the settlement contract call | A pending schedule and its intended execution time are visible |
| FR-08 | P0 | Exchange the loan and cash legs atomically | Both balances change or neither balance changes |
| FR-09 | P0 | Recheck eligibility during settlement | Revoking buyer eligibility before execution causes a full revert |
| FR-10 | P0 | Commit a private interest notice to HCS | HCS stores the hash, facility and period, not the notice |
| FR-11 | P0 | Verify and calculate accrual in a CRE confidential workflow | Correct input produces output; altered input aborts |
| FR-12 | P0 | Distribute interest in mock USD | Every holder receives the amount calculated from the snapshot |
| FR-13 | P0 | Provide institution wallet setup, a blotter, portfolio, multi-asset register, transfer requests, interest and payments, and approvals | A new judge can complete the guided flow without a CLI |
| FR-14 | P0 | Link material transactions to HashScan | Issue, RFQ, schedule and settlement receipts are inspectable |
| FR-15 | P1 | Demonstrate freeze and pause controls | Default freeze and amendment pause block the expected actions |
| FR-16 | P1 | Encrypt RFQ payloads | Authorised participants can read them; public observers cannot |

### 5.3 Non-functional requirements

| Area | Requirement |
|---|---|
| Security | No private key, API credential or confidential notice may be committed to the repository or ledger |
| Privacy | Only synthetic data may be used on public testnet |
| Reliability | Settlement must be idempotent and protected against replay and double execution |
| Auditability | Every application state must link to its source transaction or message |
| Usability | The end-to-end trade should take under five minutes in the guided demo |
| Accessibility | Critical state must not be conveyed by colour alone |
| Testing | Contracts cover approval, allowance, eligibility, replay and atomic-revert paths |

### 5.4 Out of scope

- primary syndication and book-building;
- legally binding production transfer of a loan interest;
- real fiat or mainnet stablecoin settlement;
- live identity verification or sanctions screening;
- borrower-consent and deemed-consent workflows;
- revolver drawdowns, amendments and waivers;
- distressed trades, participations and multi-currency facilities;
- an order book or automated matching engine; and
- production custody, HSM and disaster-recovery arrangements.

---

## 6. Technical Architecture

### 6.1 System view

```mermaid
flowchart TB
    subgraph UX[Institutional web application]
        B[RFQ blotter]
        P[Portfolio and register]
        A[Institution: wallet setup and approvals]
        I[Issuance wizard and multi-asset register]
    end

    subgraph CONTROL[Identity and control]
        PRIVY[Privy authentication, wallets and quorum policy]
        AGENT[Administrative-agent service]
        PAY[Paying-agent payout script]
    end

    subgraph HEDERA[Hedera testnet]
        ATS[ATS ERC-3643 loan token]
        SETTLE[SettlementEngine]
        USD[HTS mock USD]
        HCS[HCS RFQ and commitment topics]
        SCHEDULE[Scheduled Transactions]
        DIST[Batched HTS interest payout]
        MIRROR[Mirror node]
    end

    subgraph CONFIDENTIAL[Confidential computation]
        CRE[Chainlink CRE workflow in TEE]
        NOTICE[Private rate-notice endpoint]
    end

    B --> HCS
    A --> PRIVY
    PRIVY --> SETTLE
    AGENT --> ATS
    AGENT --> HCS
    SETTLE --> ATS
    SETTLE --> USD
    SETTLE --> SCHEDULE
    HCS --> MIRROR
    MIRROR --> CRE
    NOTICE --> CRE
    CRE --> PAY
    PAY --> DIST
    I --> ATS
    I --> HCS
    DIST --> USD
    MIRROR --> B
    MIRROR --> P
```

### 6.2 Responsibility by component

| Component | Responsibility | Why it belongs here |
|---|---|---|
| Hedera ATS | Issue the loan token and enforce identity-based transfer controls | Reuses a security-token framework instead of creating a custom register |
| `SettlementEngine` | Store trade state and execute both settlement legs | Atomicity must sit inside one execution boundary |
| HTS mock USD | Represent the permissioned payment leg | Native KYC, freeze and pause controls mirror institutional cash restrictions |
| HCS | Order RFQ events and anchor hashes of private notices | Creates a timestamped trail without publishing the underlying notice |
| Scheduled Transactions | Hold an approved contract call until the agreed date | Supports deferred execution and network-visible status |
| Mirror node | Serve read models for the UI and CRE verification | Keeps high-volume reads away from consensus transactions |
| Privy | Authenticate users and enforce wallet-action quorum | Models the separation between trader, compliance and portfolio authority |
| Chainlink CRE | Verify committed confidential inputs and calculate accrual in a TEE | Keeps private terms outside the public ledger and application server |
| Paying agent (`ops/src/pay-interest.ts`) | Verify the released distribution against the HCS commitment and pay it in atomic HTS batches, with catch-up for holders skipped earlier | The disclosed fallback for an on-chain distributor; the trusted role is limited to delivery and every payout is receipted on HCS |
| Market tick (`web/src/lib/automated-desk.ts`) | After any API response: onboarding steps, gas float, automated signatures and co-signatures, broadcasts, settlement sync, market making | No long-lived process is needed on the hosted demo |

### 6.3 Trade state model

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> AwaitingApprovals: RFQ accepted
    AwaitingApprovals --> Scheduled: both desks authorised
    AwaitingApprovals --> Cancelled: cancelled or expired
    Scheduled --> Settled: both transfers succeed
    Scheduled --> Failed: compliance, balance or allowance fails
    Failed --> AwaitingApprovals: corrected and reissued
    Settled --> [*]
    Cancelled --> [*]
```

The contract must reject invalid transitions, repeated settlement, changed economics after approval and calls from unauthorised accounts.

### 6.4 Data model

| Record | Minimum fields |
|---|---|
| Credit agreement | name, borrower, agent bank, dated, document reference, governing law |
| Asset (one ATS security per facility or tranche) | symbol, name, synthetic ISIN, token address and id, principal, maturity, facility type, document reference, creation receipt, source (ops scripts or browser issuance), tradeable flag, allocations |
| Institution | institution ID, members and roles, Privy key quorum, policy, desk wallet, reserve-signer public key (judge desks), Hedera account, onboarding step receipts, gas top-ups, KYC and eligibility status |
| RFQ | RFQ ID, facility, side, par amount, response deadline, creator |
| Quote | quote ID, RFQ ID, counterparty, price, settlement date, expiry |
| Trade | trade ID, accepted quote hash, buyer, seller, par, cash amount, state, schedule ID |
| Interest period | facility, record date, payment date, commitment hash, HCS sequence, output hash |
| Distribution | period, holder snapshot reference, recipient, amount, payment status |

Monetary values use integers in the smallest supported unit. Prices and rates use fixed-point integers; floating-point arithmetic is prohibited in contracts.

---

## 7. Privacy, Security and Legal Boundaries

### 7.1 Privacy model

```mermaid
flowchart LR
    PUBLIC[Public testnet<br/>synthetic positions and receipts]
    PRIVATE[Private deployment<br/>participant-only ownership and settlement]
    TEE[CRE TEE<br/>loan terms and accrual inputs]
    PRIVY[Privy<br/>users, roles and approvals]

    TEE -->|calculated output only| PUBLIC
    PRIVY -->|authorised wallet action only| PUBLIC
    PUBLIC -. same application pattern .-> PRIVATE
```

The hackathon uses public Hedera testnet so judges can inspect transactions. A production deployment cannot expose lender positions, trade prices or confidential facility terms publicly. HashSphere is the proposed private-network route because Hedera describes it as providing the same technology, services and toolkits within a private environment. This must still be validated through a production architecture review; testnet portability does not by itself prove that every operational configuration will be unchanged.

| Data | Testnet treatment | Production requirement |
|---|---|---|
| Lender identity | Fictional institution and role | Permissioned identity with minimum necessary disclosure |
| Position and trade amount | Synthetic | Private network or confidential representation |
| RFQ and quote | Synthetic plain text for demo | Encrypted payload and restricted submit/read policy |
| Credit agreement and rate notice | Never uploaded | Private document store; only hashes or references on-ledger |
| Individual approvals | Stored in Privy | Retained under institutional access and audit policy |
| Settlement receipt | Public | Visible to participants, agent and authorised supervisors |

### 7.2 Security controls

- Separate issuer, compliance, paying-agent and venue permissions.
- Bind every approval to a hash of the complete settlement instruction.
- Use nonces, expiries and settled flags to prevent replay.
- Apply checks-effects-interactions and reentrancy protection in settlement contracts.
- Recheck ATS eligibility at execution rather than relying on approval-time status.
- Hash confidential notices with a random 32-byte nonce to resist guessing.
- Verify the CRE commitment before calculation and reject mismatched inputs.
- Keep relayer authority narrow, rotate credentials and make submissions idempotent.
- Record failure reasons without logging confidential input data.

### 7.3 Legal boundary

The prototype demonstrates a technical register; it does not establish that possession of a token constitutes legal ownership of a loan. A production launch requires counsel to align the token, agent register, credit agreement, assignment documentation, perfection, custody and insolvency treatment. The proposed sequence is:

1. mirror real positions in a non-authoritative shadow register;
2. reconcile the shadow register against the agent's books;
3. obtain a legal opinion and amend the governing documents; and
4. move to an authoritative digital register for a controlled pilot facility.

---

## 8. Delivery Plan

### 8.1 Five-day plan

| Day | Deliverable |
|---|---|
| 1 | Confirm ATS deployment, Privy signing path and CRE interfaces; issue the loan and mock-USD tokens; onboard test institutions |
| 2 | Implement and test `SettlementEngine`; execute one atomic test settlement; expose HashScan receipts |
| 3 | Build the RFQ blotter, portfolio and approval inbox; connect Privy quorum; schedule an end-to-end settlement |
| 4 | Add HCS notice commitment, confidential CRE calculation and interest distribution; test altered-notice rejection |
| 5 | Add lifecycle controls, fix the highest-impact usability issues, publish documentation and record the demo |

### 8.2 Build order and fallback decisions

| Dependency | Primary path | Controlled fallback |
|---|---|---|
| Privy to Hedera | Privy EVM wallet calls contracts through Hedera JSON-RPC | Use Privy for policy-bound EVM approval only; keep native administrative transactions in the backend demo account |
| Deferred settlement | Hedera `ScheduleCreateTransaction` wrapping `ContractExecuteTransaction` with `waitForExpiry` | Execute the same contract call manually at the chosen demo time and label scheduling incomplete |
| CRE delivery | Relayer submits verifiable CRE output to `InterestDistributor` | Store and display the simulated signed/attested output, then submit through an authorised demo adapter |
| Interest payout | Contract-mediated HTS distribution to the small demo holder set | Batched Hedera SDK transfers signed by the paying agent (the path taken), with catch-up runs for holders skipped earlier |

Fallbacks must be disclosed in the README and demo. A simulated or adapted path must never be presented as a production integration.

### 8.3 Definition of done

The MVP is complete only when a judge can:

1. inspect an ATS-issued tranche and three eligible holders;
2. observe a rejected transfer to an ineligible account;
3. create, quote and accept an RFQ;
4. see that one internal approver is insufficient;
5. complete the required approvals and inspect the pending settlement;
6. execute settlement and confirm both balances changed together;
7. revoke eligibility in a second scenario and observe a full revert;
8. inspect the HCS notice commitment;
9. see a valid CRE calculation and an altered-notice rejection; and
10. confirm interest arrived in each holder's mock-USD balance.

### 8.4 Hackathon alignment

| Evaluation area | Demonstrated contribution |
|---|---|
| Asset Tokenization Studio | ERC-3643 issuance, lender eligibility, restricted transfer and lifecycle controls |
| Secondary market | Market-appropriate RFQ workflow and atomic delivery-versus-payment settlement |
| Hedera services | ATS, HTS, HCS, Smart Contract Service, Scheduled Transactions and mirror-node reads each have a defined role |
| Chainlink confidential workflow | Private notice retrieval, commitment verification and accrual calculation inside a TEE |
| Privy B2B workflow | Role-based 2-of-3 approval before an institutional wallet action |
| Product execution | A browser-based, end-to-end flow with positive and negative test cases and inspectable receipts |

### 8.5 Status at submission (updated 2026-09-13)

| Requirement | Status | Evidence |
|---|---|---|
| FR-01 to FR-04, FR-06 to FR-09 | Done on testnet | README "Live on Hedera testnet" and "Settlement evidence" |
| FR-05 Privy 2-of-3 | Done | Provisioned quorums and policies; one signature is insufficient in the app. Self-service judge desks are a genuine 2-of-3 of trader, automated compliance co-signer and a per-desk reserve key |
| FR-10, FR-11 | Done in the local CRE simulator | `cre/evidence/latest.json`; live enclave deployment needs Confidential Workflows private beta, enrolment requested |
| FR-12 Interest payout | Done via the disclosed fallback | Paying agent pays the CRE-released distribution in atomic HTS batches per asset, with `--catch-up` for holders skipped earlier; periods 2 and 3 paid on Tranche A and period 1 on the other assets; README "Interest payout" |
| FR-13, FR-14 | Done | Institution (wallet setup as three phases, approvals), Loan registry (issue, register, transfer requests, interest & payments, administration), Secondary exchange, Positions; HashScan receipts throughout |
| Multi-asset register and browser issuance (§4.1) | Done on testnet | One credit agreement with `MHTLB-A`, `MH-RCF`, `MH-DDTL` from the ops scripts plus tranches issued from the wizard (`MHTLB-B`, `MHTLB-C`); lender pars read through `RegisterSnapshot`; docs/issuance-guide.md |
| Self-service judge desks and automated institutions | Done | Any email gets its own institution; Aldgate market-makes and Bishopsgate counterparties the transfer-request demo; docs/demo-runbook.md |
| FR-15 Freeze and pause | Done | `npm run demo:controls`; README "Lifecycle controls" |
| FR-16 Encrypted RFQ payloads | Not done | RFQ messages are synthetic plain text on the public topic |
| Shadow-register integration (§10.3) | Done | Register reconciliation with HCS attestation and LSTA-style assignment export; README "Integration hooks" |
| Retail feeder holders on public network (§9.5) | Done on testnet | 25 holders onboarded as KYC-gated register positions in 150 transactions; paid in period 3 in four atomic batches; README "Retail feeder holders on public testnet" |

One Privy desk wallet (Halcyon) has not yet executed its mock-USD association intent, so the payout script skips it with the reason recorded on the HCS receipt until its quorum signs; a catch-up payout then pays it. Meridian's earlier skip is settled the same way. This is a demo-provisioning gap, not a design limitation. Desk wallets on testnet are kept above 8 HBAR by the operator so their Privy-signed transactions can reserve gas.

---

## 9. Validation and Success Measures

### 9.1 Hackathon success metrics

| Measure | Target |
|---|---|
| End-to-end settlement completion | 100% on the documented happy path |
| Partial settlement incidents | 0 |
| Negative-path contract tests | Approval, allowance, eligibility, replay and notice mismatch all pass |
| Guided demo completion time | Under five minutes |
| Practitioner reviews | At least three loan-market or operations practitioners |
| Structured test-user responses | At least five |
| Changes made from feedback | At least two, recorded in the README |

### 9.2 Pilot metrics

The post-hackathon pilot should measure outcomes rather than network activity alone:

- median time from trade agreement to settlement readiness;
- number and age of unmatched exceptions;
- time spent reconciling agent and counterparty records;
- failed settlements by cause;
- delayed-compensation events avoided;
- cash and collateral held while awaiting settlement; and
- agreement rate between the shadow register and the agent's books.

### 9.3 Validation plan

During the hackathon, three groups should review the product:

| Reviewer | Question |
|---|---|
| Loan trader or operations practitioner | Does the RFQ-to-settlement sequence reflect the real desk workflow? |
| ATS, Privy and Chainlink engineers | Are the integrations being used as intended, and which assumptions remain? |
| Test user unfamiliar with the project | Can the trade be completed without crypto-specific guidance? |

Feedback should be recorded as: observation, evidence, decision and resulting change. Placeholder endorsements must not appear in the pitch.

### 9.4 Validation record

[docs/validation.md](docs/validation.md) holds every recorded signal in the observation, evidence, decision and change format. At submission it contains: the Indian bank interest described in §1 and §2.6, and seven evidence-driven engineering changes from testnet incidents. The practitioner-review target in §9.1 is not yet met, and the record says so.

### 9.5 Network impact

Each institution becomes a Hedera account, every trade produces HCS messages and scheduled contract executions, and every accrual period produces consensus transactions. The README's "Network impact" section gives the per-institution, per-trade and per-period transaction counts and a worked example for one agent's book. A HashSphere deployment keeps the same transaction shape.

The measure that matters for institutional flow is value, not throughput. On the README's assumptions, one agent's 200-facility book puts US$120bn of loan par on the register, settles US$4bn of secondary notional and pays US$8.7bn of interest through the network per year, at roughly US$4m of value per settlement or payout transaction; at Versana scale those figures are US$900bn, US$30bn and US$65bn. The cash leg requires that money to sit in a regulated payment token on the same ledger, and an on-register loan position with atomic settlement becomes collateral that can be pledged for secured funding or OTC derivatives margin on that ledger, which is Fullmetal Finance's existing business. That collateral pool is orders of magnitude larger than any retail flow a network can attract, and it arrives through a few thousand institutional accounts.

The intended topology is two layers with one transaction shape: the institutional core (register, RFQ market, settlement between institutions) on HashSphere, because positions and prices cannot be public, and retail feeder holders on public Hedera, because retail custody and transferability need the public network. The feeder is the bridge: one institutional lender on the HashSphere register and the issuer of many small positions on the public network. Public-network account growth therefore comes from the retail layer, and it is built: `ops/src/feeder-demo.ts` onboarded 25 feeder holders on public testnet as KYC-gated register positions (150 transactions), the enclave took the 30-holder snapshot in one call through the `RegisterSnapshot` helper, and the payout credited 28 holders in four atomic batches. The README extrapolates that to a labelled scenario (one in ten facilities with a 5,000-holder feeder) of about 750,000 accounts and 9m interest transfers a year.

---

## 10. Business Model and Adoption

### 10.1 Initial customer

The initial buyer is a CLO manager or credit fund with frequent secondary trading and a loan-operations team that bears the cost of delayed settlement. The administrative agent is the essential system partner because it controls the official lender register.

Fullmetal Finance's route to that partner runs through its existing OTC derivatives relationships: the collateral and settlement desks that use the derivatives stack sit next to the loan-operations and agency desks that SyndicateLend serves. The Indian banks that indicated interest are both lead banks on consortium facilities and derivatives counterparties, so one relationship covers both roles.

### 10.2 Commercial model

Potential revenue streams are:

- a settlement fee per completed trade;
- a facility onboarding and integration fee;
- an annual register-maintenance fee; and
- an interest-distribution service fee.

Pricing is not validated in the hackathon and should not be presented as established market willingness to pay.

### 10.3 Adoption path

1. Run a shadow-register pilot with one buy-side institution and one administrative agent.
2. Compare the tokenised workflow with the same real-world operational process.
3. Integrate with existing sources such as agent-bank systems, ClearPar or Versana rather than asking users to re-enter data. The reconciliation and assignment-export adapters in `ops/` are the first two such hooks and run against the testnet register today.
4. Establish the legal basis for the digital register on one facility.
5. Expand across facilities administered by the same agent.

### 10.4 Competitive position

| Category | Strength | Remaining gap addressed by SyndicateLend |
|---|---|---|
| ClearPar | Established settlement workflow and documentation | Atomic exchange of a digital loan position and payment |
| Loan IQ | Agent-bank servicing and books of record | A participant-verifiable cross-institution register |
| Versana | Normalised, real-time agent data | Transfer and settlement of ownership |
| Tokenised CLOs | On-chain issuance of securitised credit exposure | Tokenisation and transfer of the underlying syndicated loan interest |

SyndicateLend should be positioned as a settlement layer that can integrate with these systems, not as a claim that their functions are unnecessary.

### 10.5 Lean Canvas

The nine-box canvas is in [docs/lean-canvas.md](docs/lean-canvas.md).

### 10.6 First pilot target and what it costs the customer

**Profile.** The agency desk of one Indian private-sector bank acting as lead bank on one term-loan facility with three to six lenders, run as a shadow register for one quarter. A CLO manager or credit fund is the second party in the US variant of the same pilot.

**What the customer commits.**

- A read-only feed of the lender register for the pilot facility (a spreadsheet export is sufficient on day one).
- Two operations staff for roughly two hours a week to enter trades in parallel and review the daily reconciliation.
- Sign-off from compliance on synthetic-data use during the shadow phase; no legal amendment until the register agrees with the books for a full quarter.

**What SyndicateLend provides.** A hosted private deployment (HashSphere or an equivalent permissioned Hedera network), institution provisioning, the daily reconciliation report and the pilot metrics in §9.2. No integration with the bank's core loan system is required for the shadow phase.

**Pricing hypothesis.** A flat pilot fee that converts to per-trade settlement and per-facility register fees on migration. The number is not stated here because it has not been tested with a buyer.

---

## 11. Risks and Open Questions

| Risk or question | Impact | Response |
|---|---|---|
| Token does not constitute legal title | Product cannot become the official register | Begin with a shadow register and obtain facility-specific legal analysis |
| Borrower or agent consent remains off-platform | Settlement cannot be fully automated | Add configurable consent states and time windows after the MVP |
| Privy cannot sign a required Hedera-native transaction | Approval flow breaks | Keep user actions on the EVM path and test this dependency on day one |
| CRE attestation or Hedera write path differs from the design | Interest delivery is not end to end | Prove confidential calculation first and isolate delivery behind a small adapter |
| Public testnet exposes transaction data | Demo could model an unsafe production design | Use synthetic data and show the private deployment boundary explicitly |
| Payment token is not commercial bank money | Atomicity is demonstrated without removing real cash risk | Treat mock USD as a test instrument; evaluate regulated stablecoin or tokenised deposit later |
| Scheduled execution fails because funds or eligibility changed | Trade misses settlement date | Recheck preconditions, report a precise failure and require a newly approved instruction |
| Five-day scope is too broad for one builder | Core flow may be unstable | Complete issuance and atomic settlement before confidential interest and P1 controls |

Open design questions for practitioner review:

- Which party should be authorised to create and cancel a settlement instruction?
- At what point should borrower and agent consent become final?
- Is T+1 a meaningful target, or should the product settle immediately once all conditions are met?
- Should the register represent assignments, participations or both?
- What evidence must an agent retain outside the ledger for a legally effective transfer?

---

## 12. Demonstration Narrative

The five-minute demo should tell one story:

1. A $5 million loan trade is agreed quickly but normally remains operationally exposed while documents, eligibility, cash and the agent register are coordinated.
2. The agent issues a synthetic facility through ATS and approves three lenders.
3. A seller requests a quote and accepts a buyer's price.
4. The buyer's trader cannot act alone; the required Privy quorum authorises the desk wallet.
5. The approved settlement appears as a scheduled transaction.
6. At execution, the loan tokens and mock USD move together. A second trade fails completely after buyer eligibility is revoked.
7. The agent publishes a hash of a private interest notice. CRE verifies the notice confidentially, calculates the distribution and rejects a modified notice.
8. Holders receive mock USD, and the application links the complete trail to Hedera records.

The pitch narrative (problem, solution, what is new, validation, business model, ask) is written out in [PITCH.md](PITCH.md).

The closing claim should remain precise:

> SyndicateLend demonstrates that a compliant loan register, institutional approvals, confidential interest calculation and atomic settlement can operate as one workflow. The next step is a shadow-register pilot with an administrative agent and a loan investor.

---

## 13. Research Sources

Market figures and product claims in this PRD were checked against the following primary or first-party sources on 10 September 2026 (sources 12–13 on 12 September 2026):

1. [LSTA — 1Q26 Secondary Trading and Settlement Study](https://www.lsta.org/content/secondary-trading-settlement-study-first-quarter-2026/) — reports $971 billion of secondary trading in 2025 and the subsequent trailing-twelve-month milestone.
2. [LSTA — 2Q25 Secondary Loan Trading Volumes](https://www.lsta.org/content/lsta-secondary-trading-monthly-executive-summary-2q25-secondary-loan-trading-volumes-spike-again-to-a-record-262-billion/) — reports index outstandings approaching $1.5 trillion and 2025 trading activity.
3. [LSTA — April 2025 market overview](https://events.lsta.org/app/uploads/2025/04/Welcome-Address-09Apr25.pdf) — mean and median par settlement-time history and the ten-year average.
4. [Versana — 1,500-facility milestone](https://versana.io/versana-surpasses-major-milestone-with-more-than-1500-syndicated-loan-facilities-now-available-on-its-transformative-digital-data-platform/) — approximately $900 billion of commitments on the platform.
5. [Galaxy — Initial closing of tokenised CLO](https://investor.galaxy.com/news-releases/news-release-details/galaxy-announces-initial-closing-debut-tokenized-clo-75-million) — $75 million closing announced in January 2026.
6. [Hedera — Asset Tokenization Studio](https://docs.tokenization-studio.hedera.com/) — ATS compliance, token operations and distribution capabilities.
7. [Hedera — Scheduled Transactions](https://docs.hedera.com/hedera/core-concepts/scheduled-transaction) — signature collection, expiry execution and supported transaction types.
8. [Hedera — HashSphere](https://hedera.com/product/hashsphere/) — private deployment model and available Hedera services and tooling.
9. [Privy — Quorum approvals](https://docs.privy.io/controls/common-use-cases/quorum-approval) — threshold authorisation for wallet actions.
10. [Chainlink — Confidential Workflows](https://chain.link/privacy) — TEE-based confidential inputs and computation in CRE.
11. [LSTA — Delayed Compensation Regime](https://www.lsta.org/content/the-lsta-delayed-compensation-regime/?ind=0&wpdmdl=1172) — operating rules for allocating economics after delayed settlement.
12. [SLMA — About the Secondary Loan Market Association (India)](https://www.slma.in/page/about-slma) — incorporated August 2020 by ten banks including SBI, ICICI Bank and HDFC Bank, following the RBI task force on a secondary market for corporate loans.
13. [LSTA — Risk Management 101: Reduce Settlement Times (Operations)](https://www.lsta.org/university/operations/) — 2021 commentary reporting 29% of par trades within T+7 and 27% beyond T+20. The chart's 44% middle bucket is the remainder of those rounded percentages.
