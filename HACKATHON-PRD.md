# SyndicateLend - Hackathon PRD

**Track:** Tokenisation of Anything (Asset Tokenization Studio)
**Secondary bounties targeted:** Privy (B2B approval workflows), Chainlink CRE (confidential compute)
**Team:** Solo founder
**Build window:** 5 days, ~55 hours
**Network:** Hedera testnet

---

## 1. Problem Statement

> Syndicated loan pieces trade every day, but settling a trade takes weeks because there is no shared infrastructure for owning and transferring a private loan contract.

When a borrower needs more than one bank will lend, a group of banks club together and lend jointly. That is a syndicated loan. It is one of the largest credit markets on earth: the US leveraged segment alone has over $1.4T outstanding, and secondary trading of loan pieces reached a record $1T in 2025 (LSTA).

Unlike a bond or an equity, a loan piece is a private bilateral contract. There is no central securities depository, no register that both counterparties can rely on, and no delivery-versus-payment mechanism. When a fund sells $5M of a term loan to an insurer, the trade is agreed in minutes but settles in weeks. The agent bank has to update its own ledger, both sides exchange paper assignment agreements, KYC has to be re-checked by hand, and cash moves separately from the asset.

The consequences are structural, not cosmetic:

- **Credit and counterparty risk** for the full settlement window. The buyer is exposed to the seller failing, and vice versa, for weeks.
- **Idle capital.** Cash and collateral sit waiting on settlement instead of being redeployed.
- **Delayed compensation.** The market runs an elaborate compensation scheme (LSTA delayed compensation rules) purely to price its own slowness. This is dead-weight operational cost.
- **Interest accrual disputes.** Interest resets, spreads, and day-count conventions are private terms that each side computes separately, then reconciles by email.

**Target Users**

| Segment | Role in the market | Pain today |
|---------|-------------------|-----------|
| Credit funds and CLO managers | Most active buyers and sellers of loan pieces | Weeks of settlement risk, manual assignment paperwork, reconciliation of accrual |
| Agent banks | Keep the register of who owns what, distribute interest | Run a bilateral ledger that nobody else can verify; process every assignment by hand |
| Insurers and pension managers | Long-term holders, occasional traders | Slow onboarding to each facility, opaque ownership record |
| Loan operations teams at all of the above | Execute settlement | Chase signatures, re-key data between systems, manage delayed-comp claims |

**Current Solutions**

| Existing player | What it does | Gap |
|----------------|-------------|-----|
| Versana (BofA, Citi, JPM backed) | Live data platform, $900B+ across 1,500+ facilities | Solves data transparency only. Agent banks feed it reference data; ownership never moves on it. |
| ClearPar (IHS Markit / S&P) | Settlement workflow platform | Coordinates documents and messages between parties. Cash and asset still move separately, off-platform. |
| LoanIQ (Finastra) | Agent bank system of record | Each agent bank runs its own instance. Not a shared register. |
| Galaxy Digital tokenised CLO (Jan 2026, $75M, Avalanche) | Tokenised a CLO structure | Proves institutional appetite for on-chain credit. Does not tokenise the underlying loan pieces or their secondary market. |

**Why Web3?**

The core problem is that the loan register is a private ledger held by one party (the agent bank) that every other party must trust and reconcile against. A Web2 solution is another database owned by another intermediary, which is exactly what Versana and ClearPar are. Both are valuable and both leave settlement untouched.

A tokenised register on a public ledger changes three things a Web2 system cannot:

1. **Ownership and transfer are the same object.** The register is the token balance. There is no separate step to "update the agent bank ledger" after a trade.
2. **Delivery and payment can be one atomic unit.** Hedera executes both legs or neither. No settlement window, no counterparty exposure during it, no delayed compensation.
3. **Compliance is enforced at the point of transfer, not audited after.** ERC-3643 compliance rules run inside the transfer itself. An ineligible assignee cannot receive the piece, so there is nothing to unwind.

---

## 2. Solution Overview

SyndicateLend is a private tokenised loan registry and RFQ-based secondary market for syndicated loan pieces, built on Hedera's Asset Tokenization Studio (ATS).

Each loan facility or tranche is issued as an ERC-3643 security token through ATS. A token balance equals par value held (one token equals one dollar of principal). ATS's identity registry and compliance controls become the loan register: only KYC-verified, eligible lenders can hold or receive a piece. This replaces the agent bank's bilateral ledger with a register every participant can verify on HashScan.

Trading follows real market structure: negotiated bilaterally through a request-for-quote (RFQ) flow, not an order book. Every RFQ, quote, and acceptance is recorded on a Hedera Consensus Service (HCS) topic as an immutable audit trail. When a trade is agreed, a settlement contract executes both legs atomically: the loan token moves from seller to buyer under full ERC-3643 compliance, and the cash leg moves in a KYC-gated HTS stablecoin. Execution is deferred to the agreed settlement date through a Hedera Scheduled Transaction, and gated by each desk's internal approval quorum enforced by Privy.

Interest is where private data meets public settlement. Loan economics (spread, day-count, reset notices) are confidential. A Chainlink CRE confidential workflow ingests the agent bank's interest reset notice inside a trusted execution environment, computes accrual per holder, and posts only the resulting distribution to Hedera. A Scheduled Transaction then pays every holder pro-rata in the HTS stablecoin on the payment date.

**Hackathon Track Alignment**

The Tokenisation of Anything track asks for "real asset classes and real lifecycle management" built with ATS, and lists a secondary market for ATS assets as extra points because the Studio does not have one today. SyndicateLend hits every extra-points item in the track description:

| Track extra-points item | SyndicateLend feature |
|------------------------|----------------------|
| Secondary market for ATS-issued assets | RFQ marketplace with atomic DvP settlement |
| Compliance controls in use | KYC grants on both loan token and stablecoin, transfer restrictions via ERC-3643 compliance, freeze on default, pause on facility amendment |
| Coupon or dividend distributions | Pro-rata interest distribution to all holders |
| Oracle integration for pricing or NAV | CRE workflow delivers accrual data; same channel can carry loan marks |
| Scheduled Transactions for coupon payments or settlement | Used for both trade settlement and interest payment |
| Contributions back upstream to ATS | Settlement engine and RFQ module designed as ATS-compatible extensions (see Parking Lot) |

### Key Features (MVP)

Build order is by judging impact. Execution and Success are 40% of the score, so the features that produce a working, demonstrable lifecycle come first.

1. **Facility token issuance via ATS with KYC grants.** Deploy an ERC-3643 loan token through the ATS SDK, register three lender identities, grant KYC, demonstrate a rejected transfer to an unverified account. This is the qualification requirement and the foundation for everything else.
2. **Atomic DvP settlement via Scheduled Transaction.** A `SettlementEngine` contract moves the loan token and the HTS stablecoin in one execution. The call is scheduled for the settlement date. This is the feature that answers the problem statement and the one judges will remember.
3. **Privy quorum approval on settlement.** A desk's trader, compliance officer, and PM must reach a 2-of-3 approval before the desk's wallet signs the settlement approval. This is the real B2B workflow and the differentiator from every other DvP demo.
4. **CRE confidential accrual workflow.** Private interest reset notice in, per-holder distribution out, paid through a Scheduled Transaction. Covers the track's oracle and coupon asks and the Chainlink bounty in one feature.
5. **RFQ flow with HCS audit trail.** Request, quote, accept, all as HCS messages, rendered in a trading blotter. If time runs short, simplify to a matched-order log with the same HCS backing.

### Non-Goals (v1)

- **No order book or continuous matching.** Loans trade by negotiation. An order book would be less realistic and more work.
- **No primary syndication.** The facility is assumed to exist. SyndicateLend tokenises an existing register; it does not run the syndication process.
- **No real fiat or real stablecoin.** The cash leg is a permissioned mock-USD HTS token on testnet.
- **No real KYC provider.** Identity verification is simulated; the identity registry is populated by an admin action. The integration point is real, the provider is not.
- **No deemed-consent window.** LSTA assignee-eligibility rules include a time-bound borrower consent process. This is v2 design, not hackathon scope.
- **No multi-currency, no revolvers with drawdown mechanics, no amendments or waivers.** Term loan pieces only.
- **No mainnet deployment.** Testnet only.
- **No production key management.** Privy embedded wallets on testnet; no HSM or Fireblocks integration.

---

## 3. Hedera Integration Architecture

### Network Services Used

| Service | Purpose | Why This Service? |
|---------|---------|-------------------|
| **Asset Tokenization Studio (ERC-3643 via ATS SDK)** | Issue one security token per facility or tranche. Identity registry plus compliance module act as the loan register. Control list, freeze, and pause map directly to loan lifecycle events. | ATS ships audited ERC-1400 and ERC-3643 contracts with KYC, control lists, lock, pause, and snapshot already built. Building the register from scratch would consume the whole hackathon and score worse. Track requires ATS. |
| **Smart Contracts (EVM)** | `SettlementEngine` executes both legs of a trade in one call. `InterestDistributor` receives the CRE report and prepares the payment. Both verified on HashScan. | The ERC-3643 token leg is an EVM call, so the atomic unit that contains both legs must be an EVM call. The HTS system contract lets that call move the stablecoin natively. |
| **Hedera Token Service (HTS)** | Permissioned mock-USD stablecoin with KYC key, freeze key, and pause key. KYC is granted to an account only after the same identity is verified in the ATS identity registry. | Native HTS compliance keys give the cash leg the same eligibility controls as the asset leg without a second compliance contract. Fixed, predictable fees for the highest-volume operation. |
| **Scheduled Transactions (HSS)** | Two uses. (a) `SettlementEngine.settle(tradeId)` is scheduled for the agreed settlement date and executes without a bot. (b) Interest distribution is a scheduled HTS transfer from the paying agent to all holders, executed on the payment date once the paying agent signs. | Hedera is the only major network with native deferred execution and on-network signature collection. The settlement instruction is visible on HashScan before it executes, which is exactly what a loan operations team needs. |
| **Hedera Consensus Service (HCS)** | One topic per facility for RFQ messages, quotes, acceptances, and trade confirmations. A second topic for agent-bank notices, which the CRE workflow reads as its input feed. | Ordered, timestamped, tamper-proof. Replaces the email and Bloomberg chat trail that loan desks keep for audit today. Cheap enough to log every negotiation step. |
| **Mirror Node** | Portfolio view, trade history, holder list for interest distribution, schedule status polling. | Read-only queries at no cost; standard for any front end. |

### Ecosystem Integrations

| Partner/Platform | Integration Type | Value Added |
|-----------------|------------------|-------------|
| **Privy** | Embedded wallets with email or SSO login; key quorum and policy controls for trade approval | Institutional users never see a seed phrase. A desk's wallet signs settlement approval only after 2-of-3 internal sign-off. This is the access-control layer missing from every other tokenised-settlement demo. Every Privy user is a new Hedera account. |
| **Chainlink CRE (Confidential Compute)** | Workflow ingests private interest notices in a TEE, computes accrual, writes the distribution to `InterestDistributor` | Loan economics stay private while the payment is public and verifiable. Turns a manual reconciliation process into an automated, provable one. |
| **HashPack** | WalletConnect for self-custody participants and read-only observer access for auditors | Hedera-native users and auditors can connect without Privy. Shows the register is open to any Hedera wallet, not locked to one provider. |
| **HashScan** | Contract verification, schedule inspection, transaction receipts linked from the UI | Qualification requirement. Every settlement in the demo links to its HashScan record. |
| **ATS upstream (hashgraph/asset-tokenization-studio)** | `SettlementEngine` and the RFQ module packaged as an ATS extension; issue opened and PR drafted during the hackathon | Track lists upstream contribution as extra points. Gives every future ATS issuer a secondary market. |
| **ATS partner network (ioBuilders, Dfns, Fireblocks, AWS KMS)** | Production key management and KYC providers already integrated with ATS, used unchanged | Path from Privy testnet wallets to institutional custody without re-architecting. |

### Ecosystem Integration Potential (post-hackathon)

The Innovation rubric rewards solutions that can plug into existing ecosystem platforms to unlock further capability. Loan tokens on ATS make these integrations possible without new primitives:

| Platform | Integration | Capability unlocked |
|----------|------------|--------------------|
| **USDC on Hedera** | Replace mock-USD as the cash leg | Real-money settlement with the same HTS controls |
| **Bonzo Finance (Hedera lending)** | Loan tokens accepted as collateral | Repo-style financing against loan pieces, the track's first listed idea |
| **Hedera Guardian** | Attach facility documents and ESG covenants as verifiable credentials | Sustainability-linked loan covenants tracked on-chain |
| **Chainlink CCIP** | Bridge loan tokens to other chains under compliance | Galaxy-style CLO structures on other chains can hold Hedera-registered loan pieces |
| **Versana / ClearPar** | Reference data in, settlement instructions in | Incumbent workflow feeds the register; ownership moves on Hedera |

### Architecture Diagram

```
                     ┌─────────────────────────────────────────────────────┐
                     │              SyndicateLend Front End                │
                     │   Next.js · ATS SDK · Hedera SDK · Privy · HashPack │
                     │   [Blotter] [Portfolio] [RFQ] [Approvals] [Register]│
                     └──────┬───────────────┬───────────────┬──────────────┘
                            │               │               │
              login/sign    │        RFQ    │        reads  │
                            ▼               ▼               ▼
                  ┌───────────────┐  ┌────────────┐  ┌──────────────┐
                  │     Privy     │  │ HCS Topics │  │ Mirror Node  │
                  │ embedded      │  │ facility   │  │ balances     │
                  │ wallets       │  │ rfq + notice│ │ schedules    │
                  │ 2-of-3 quorum │  └─────┬──────┘  │ history      │
                  └──────┬────────┘        │         └──────────────┘
                         │                 │ reads notices
                         │ signs           ▼
                         │        ┌─────────────────────┐
                         │        │   Chainlink CRE     │
                         │        │ confidential workflow│
                         │        │ TEE: notice → accrual│
                         │        └─────────┬───────────┘
                         │                  │ writes distribution
   ══════════════════════╪══════════════════╪══════════════ Hedera testnet ══
                         ▼                  ▼
   ┌────────────────────────────┐   ┌───────────────────────┐
   │  ATS Loan Token (ERC-3643) │   │  InterestDistributor  │
   │  identity registry = KYC   │   │  holders × accrual     │
   │  compliance = eligibility  │   └──────────┬────────────┘
   │  freeze / pause / snapshot │              │ creates
   └──────────────┬─────────────┘              ▼
                  │ transferFrom      ┌────────────────────────┐
                  ▼                   │  Scheduled Transaction │
   ┌────────────────────────────┐    │  HTS transfer to holders│
   │     SettlementEngine       │    │  paying agent signs     │
   │  approve(tradeId) ×2       │    └────────────────────────┘
   │  settle(tradeId):          │
   │    loan token  seller→buyer│◄─── Scheduled Transaction
   │    stablecoin  buyer→seller│     ContractExecute at T+1
   │    both or neither         │
   └──────────────┬─────────────┘
                  │ HTS system contract (0x167)
                  ▼
   ┌────────────────────────────┐
   │  HTS mock-USD stablecoin   │
   │  KYC key · freeze · pause  │
   └────────────────────────────┘
```

### Settlement Flow (the demo's centrepiece)

1. Seller posts an RFQ on the facility's HCS topic: facility, par amount, side.
2. Buyer responds with a quote (price as percentage of par). Seller accepts. All three messages land on HCS with consensus timestamps.
3. Front end creates the trade in `SettlementEngine` with both parties, amounts, and settlement date T+1.
4. Seller grants the engine an ERC-3643 allowance for the loan tokens. Buyer grants an HTS allowance for the stablecoin. Both are ordinary approvals from each party's Privy wallet.
5. Each desk calls `approve(tradeId)`. Privy's policy requires 2-of-3 internal approvals (trader, compliance, PM) before the desk wallet signs this call.
6. The engine, on receiving the second approval, schedules `settle(tradeId)` for the settlement date. Preferred path: the contract calls the Hedera Schedule Service system contract (`scheduleCall`, HIP-1215) so the trade schedules its own settlement. Fallback: the backend creates the schedule with the SDK.
7. At settlement time Hedera executes the scheduled call. `settle` moves the loan token via `transferFrom` (ERC-3643 compliance runs here and reverts if the buyer is no longer eligible) and moves the stablecoin via the HTS system contract. One execution, both legs or neither.
8. The engine posts a trade confirmation to HCS. The blotter updates from the mirror node. HashScan link shown.

A note on design accuracy: a Hedera Scheduled Transaction wraps exactly one transaction body, and an atomic batch (HIP-551) cannot itself be scheduled. Atomicity therefore lives inside the `settle` call, and the Scheduled Transaction provides deferred execution and on-chain visibility of the pending settlement. See Design Decisions for the alternative that was considered.

---

## 4. Hedera Network Impact

Every participant, every facility, every trade, and every interest period creates Hedera entities and transactions by design. The model below uses market-wide figures so judges can see what full adoption means, and pilot figures so the near-term numbers are credible.

### The Unit Economics of One Facility

A typical US leveraged loan facility has 100 to 200 lenders of record (LSTA). Each lender is an institution with several authorised signers. Interest resets monthly or quarterly. Pieces of the facility trade many times a year.

| Event | Hedera entities and transactions created |
|-------|------------------------------------------|
| Facility onboarded | 1 ATS security token, 1 identity registry entry per lender, 2 HCS topics |
| Lender onboarded | 1 desk account, 3 signer accounts (Privy), 1 stablecoin association, 1 KYC grant on each token |
| Trade | 3 to 5 HCS messages, 2 allowances, 2 approvals, 1 schedule entity, 1 scheduled execution, 1 confirmation message: about 10 transactions |
| Interest period | 1 CRE report write, 1 snapshot, 1 schedule entity, 1 transfer to N holders (batched in groups of 10), 1 HCS notice: 20 to 40 transactions per facility per period |
| Observer or auditor | 1 HashPack account connect |

### Account Creation

| Stage | Institutions | Facilities | New Hedera accounts |
|-------|-------------|------------|---------------------|
| Hackathon demo and outreach | 5 (simulated) plus judges, mentors, and community observers | 2 | 30 to 60 |
| Year 1 shadow-register pilots | 30 to 50 | 50 | 150 to 300 |
| Year 3, 10% of US facilities | 500 | 150 | 2,000 to 3,000 |
| Full US market | 2,000 plus institutional lenders (LSTA membership and CLO manager count) | 1,500 (Versana's coverage) | 8,000 to 12,000 |

Every one of these is an account that transacts, not an airdrop recipient. Institutional accounts are the audience Hedera's council was built to attract.

### Active Accounts

| Stage | Monthly active accounts | Driver |
|-------|------------------------|--------|
| Demo | 20 to 30 | Every demo run touches 2 desks, 6 signers, the paying agent, the operator |
| Year 1 | 100 to 200 | Weekly trading desks plus monthly interest events touching every holder |
| Year 3 | 1,500 to 2,500 | Interest resets alone activate every holder of every facility every month |
| Full market | 6,000 to 10,000 | Same |

Interest distribution is the flywheel. A holder who never trades is still an active account every reset date, because the scheduled payment lands in their wallet.

### Transactions Per Second (TPS)

| Stage | Trades/day | Facilities | Interest tx/month | Daily transactions | Average TPS |
|-------|-----------|------------|------------------|-------------------|-------------|
| Demo | 5 to 10 | 2 | 60 | 50 to 100 | negligible |
| Year 1 | 50 | 50 | 1,500 | 500 to 700 | 0.01 |
| Year 3 | 400 | 150 | 6,000 | 4,000 to 5,000 | 0.05 |
| Full US market (300k to 400k trades/yr) | 1,400 | 1,500 | 60,000 | 15,000 to 20,000 | 0.2 sustained, 5 to 10 at reset-date peaks |

Sustained TPS is modest by Hedera's capacity. Two things make it significant anyway:

- **Value per transaction.** Average loan trade is $2M to $5M par. Full-market adoption is $1T per year settling on Hedera, more notional than any existing Hedera application.
- **Reset-date peaks.** Interest resets cluster on month-end and quarter-end. On those days every facility pays every holder in the same window, which is exactly the burst load Scheduled Transactions and HTS batching are designed for.

### Audience Exposure

- **A new audience for every public chain.** Loan operations teams, agent banks, credit funds, and CLO managers do not use any blockchain today. SyndicateLend is built in their language (RFQ, par, assignee eligibility, delayed comp) rather than DeFi's.
- **The industry body as a channel.** The LSTA (Loan Syndications and Trading Association) sets the rules the market runs on and has an active technology and innovation working group. A working ATS demo is a concrete artefact to bring to that group, and a case study for Hedera's enterprise marketing.
- **Council-member alignment.** Hedera's governing council includes global banks and financial infrastructure firms. Syndicated lending is a core business line for several of them.
- **ATS ecosystem growth.** A secondary market makes ATS more attractive to every future issuer, not only loan issuers. Bonds and equities issued through ATS get the same settlement engine.
- **Target market size:** $1.4T outstanding US leveraged loans, $1T annual secondary trading volume, roughly 300k to 400k trade tickets per year. Global syndicated loan issuance exceeds $5T per year (LSTA, PitchBook LCD, LSEG; confirm exact figures before the pitch).

---

## 5. Innovation & Differentiation

### Ecosystem Gap

Hedera has ATS for issuance and lifecycle, but no secondary market for ATS-issued assets. The track description says this explicitly. SyndicateLend is the first negotiated secondary market on ATS with compliance enforced inside settlement, and the first tokenisation of syndicated loan pieces on Hedera. Nothing in the Hedera ecosystem represents a private credit contract as a compliant, transferable, interest-bearing token with atomic settlement.

### Cross-Chain Comparison

No project on any chain combines all four of: a compliant token register for syndicated loan pieces, a negotiated secondary market, atomic delivery-versus-payment, and confidential computation of private loan economics. Each existing project has one or two.

| Project | Chain | Register | Secondary market | Atomic DvP | Private terms | What SyndicateLend adds |
|---------|-------|----------|-----------------|-----------|---------------|------------------------|
| Galaxy Digital tokenised CLO (Jan 2026) | Avalanche | CLO notes only | No | No | No | Tokenises the underlying loan pieces and their trading, not a wrapper around a pool |
| JPMorgan Kinexys tokenised collateral and intraday repo | Private (Onyx) | Yes, permissioned | No | Yes | Bank-internal | Public network, multi-institution, any lender can join through KYC rather than through JPM |
| Broadridge DLR (repo, $1T+ monthly) | Private (DAML) | Yes | No | Yes | Private ledger | Same DvP guarantee on a public ledger where the register is verifiable by all parties, not the operator |
| HQLAx, Goldman DAP | Private | Yes | No | Yes | Private ledger | Same as above; also targets loans, which none of these do |
| CRE-triggered DvP escrow demos | Various EVM | Generic ERC-20 | No | Yes | No; CRE used as webhook | ERC-3643 compliance inside the transfer; CRE used for confidential accrual computation |
| Maple, Centrifuge, Goldfinch | Ethereum, others | Pool shares | Limited | No | No | Tokenises the existing $1.4T bank-syndicated market rather than originating crypto-native loans |
| Versana, ClearPar | None | Data only | No | No | Yes, off-chain | Ownership moves on SyndicateLend; it does not on either of them |

The institutional projects (Kinexys, DLR, HQLAx, DAP) prove that the mechanism works and that banks want it. They are all closed, single-operator ledgers. The public-chain projects prove that tokenised credit finds holders. None of them touch the syndicated loan secondary market, which is larger than the repo segments most of them serve and slower to settle by an order of magnitude.

### Novel Hedera Usage

- **A trade that schedules its own settlement.** `SettlementEngine` calls the Schedule Service system contract from inside the EVM (HIP-1215) to schedule its own `settle` call at T+1. No bot, no cron job, and the pending settlement is visible on HashScan before it executes. This is a non-obvious use of Scheduled Transactions.
- **Two compliance systems kept in lockstep.** ERC-3643 identity registry for the asset leg and HTS KYC key for the cash leg, granted together. An account that loses eligibility is frozen on both sides at once.
- **HCS as both audit log and oracle input.** The agent-bank notice topic is simultaneously the immutable record that a notice was issued and the feed the CRE workflow reads. The notice content is encrypted to the workflow; the fact of the notice is public.
- **ATS lifecycle controls mapped to loan events.** Freeze on borrower default, pause on facility amendment, snapshot at interest record date, control list as assignee eligibility. These are ATS features designed for bonds and equities, applied to a new asset class.

---

## 6. Feasibility & Business Model

### Technical Feasibility

- **Hedera Services Required:** ATS SDK and contracts, Smart Contracts (EVM) with HTS and HSS system contracts, HTS, Scheduled Transactions, HCS, Mirror Node.
- **Team Capabilities:** Solo founder. Solidity (Uniswap v4 hooks; TrueLend, 1st place UHI7, in external audit; TruePerp for UHI10). Move on Sui (Fullmetal derivatives MVP). TypeScript and Next.js. Four years building institutional OTC derivatives infrastructure, which is the domain adjacent to loan trading. Four hackathon wins in the past year including 1st place Arc track at ETHGlobal HackMoney.
- **Technical Risks and Mitigation:**

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Privy cannot sign Hedera native transactions (ScheduleSign, HTS allowance) | Medium | Day 1 spike. Hedera accounts can be ECDSA-keyed; Privy raw signing over the transaction body hash should work. Fallback: Privy signs only EVM calls via JSON-RPC relay (Hashio), and all native operations (allowances, schedule signing) are routed through EVM system contracts or the venue operator account. |
| Chainlink CRE has no Hedera testnet write target, or confidential compute is not available on the developer tier | Medium | Day 1 check. Fallback: CRE workflow runs and produces a signed report; a thin relayer posts the report to `InterestDistributor` via the Hedera SDK. The confidential computation still happens in CRE; only the last mile changes. State this honestly in the demo. |
| HIP-1215 `scheduleCall` from within a contract behaves unexpectedly on testnet | Medium | Fallback: backend creates the `ScheduleCreateTransaction` wrapping `ContractExecuteTransaction` with the SDK. Same user-visible behaviour. |
| ATS ERC-3643 mode requires deploying a separate compliance and identity registry contract | High (this is how ATS works) | Use ATS's own identity registry and compliance contracts from the repo. Budget half a day. Reuse the ATS testnet deployment addresses where the SDK supports them. |
| HTS transfer to many holders in one scheduled transaction hits the per-transaction transfer limit | Low for demo (3 to 5 holders) | For larger holder counts, batch into multiple scheduled transfers per period. Note in roadmap. |
| Solo builder runs out of hours | Medium | Features are ordered so that a demo exists from day 2. RFQ (feature 5) degrades to a matched-order log. CRE (feature 4) degrades to the relayer fallback. |

### Business Model (Lean Canvas)

| Element | Description |
|---------|-------------|
| **Problem** | 1. Loan trades take weeks to settle, exposing both sides to credit risk. 2. The register is a private ledger nobody else can verify. 3. Interest accrual on private terms is reconciled by hand. |
| **Solution** | 1. Atomic DvP settlement on the agreed date. 2. ATS ERC-3643 token as a shared, compliant register. 3. Confidential accrual computation with automated distribution. |
| **Key Metrics** | Par value on register, par value settled per month, median settlement time (target T+1 vs T+20 today), number of facilities, number of active desks, delayed-compensation claims avoided. |
| **Unique Value Prop** | Settle a loan trade in one day instead of three weeks, with compliance enforced inside the transfer. |
| **Unfair Advantage** | Founder has four years of institutional OTC infrastructure experience and knows how desks actually approve trades. First mover on ATS secondary markets. Design matches real market structure (RFQ, quorum approval, private terms) rather than a DeFi template. |
| **Channels** | LSTA technology and innovation working group. Direct outreach to loan operations at agent banks and CLO managers. Partnership discussions with ClearPar, LoanIQ, and Versana as integration points rather than competitors. Hedera Foundation enterprise network. |
| **Customer Segments** | Primary: CLO managers and credit funds (most active traders, most pain). Secondary: agent banks (register owners). Tertiary: insurers and pensions (holders). |
| **Cost Structure** | Engineering (founder plus one). Legal and regulatory review of the token structure. Hedera network fees (negligible at pilot scale). Privy and Chainlink usage fees. Compliance and KYC provider fees once live. |
| **Revenue Streams** | Per-trade settlement fee in basis points of par (the market already pays this to ClearPar). Facility onboarding fee paid by the agent bank. Annual register maintenance fee per facility. Later: interest distribution service fee. |

### Why Web3 is Required

The value is not "a database on a blockchain." It is that ownership, transfer, compliance, and payment collapse into a single verifiable object. A Web2 register still needs cash to move on a separate rail and still needs each party to trust the operator's ledger. Atomic DvP between an asset and a payment, with compliance enforced in the same execution, only exists on a shared ledger that both legs live on. Hedera specifically adds native deferred execution (Scheduled Transactions) and native compliance keys on the cash leg (HTS), which would otherwise require custom escrow contracts on other chains.

---

## 7. Execution Plan

### MVP Scope (Hackathon)

| Feature | Priority | Estimated Effort | Hedera Service |
|---------|----------|-----------------|----------------|
| Day 1 spikes: Privy Hedera signing, CRE reachability, ATS SDK setup | P0 | 4h | ATS, Privy, CRE |
| ATS facility token issuance with identity registry and KYC grants; rejected transfer to unverified account | P0 | 6h | ATS (ERC-3643) |
| HTS mock-USD stablecoin with KYC, freeze, pause keys; KYC grant tied to identity registry | P0 | 2h | HTS |
| `SettlementEngine` contract: create, approve, settle; Foundry tests; deploy and verify on HashScan | P0 | 8h | Smart Contracts, HTS system contract |
| Scheduled settlement: HSS `scheduleCall` from contract, SDK fallback | P0 | 4h | Scheduled Transactions |
| Privy login, embedded wallet, Hedera account creation, 2-of-3 quorum policy on `approve` | P0 | 6h | Privy |
| Front end: blotter, portfolio, register view, approvals inbox, HashScan links | P0 | 10h | Mirror Node |
| `InterestDistributor` contract and CRE confidential workflow (notice in, accrual out) | P1 | 8h | CRE, Smart Contracts |
| Scheduled interest distribution signed by paying agent | P1 | 2h | Scheduled Transactions, HTS |
| RFQ flow on HCS topic (request, quote, accept, confirm) | P1 | 5h | HCS |
| HashPack connect for observer access | P1 | 1h | HashPack |
| Freeze and pause demo (borrower default, facility amendment) | P1 | 1h | ATS |
| Public testnet walkthrough page with in-app feedback form (validation tier 3) | P1 | 2h | Mirror Node |
| ATS upstream: GitHub issue describing the secondary-market extension, draft PR skeleton | P1 | 1h | ATS |
| README, demo video, submission | P0 | 5h | HashScan |

Total: roughly 66 hours against a 55-hour budget. The RFQ polish and the CRE last-mile are the cut line; the walkthrough page and the ATS issue are cheap and each moves a 15% criterion, so they stay.

### Daily Plan

| Day | Hours | Deliverable |
|-----|-------|-------------|
| 1 | 12 | Spikes resolved with go/no-go on Privy native signing and CRE write path. ATS loan token on testnet with 3 KYC'd holders. Stablecoin deployed. Message 5 practitioner contacts to book day-3 reviews. |
| 2 | 12 | `SettlementEngine` tested and verified on HashScan. First atomic DvP executed via Scheduled Transaction from a script. A demo exists from this point. Sponsor SME review of quorum and CRE design (feedback cycle 1). |
| 3 | 12 | Front end with blotter, portfolio, register. Privy login and quorum approval wired to `approve`. End-to-end trade from the UI. Record rough demo, send to practitioners (feedback cycle 2). Open ATS GitHub issue. |
| 4 | 10 | CRE workflow and `InterestDistributor`. Interest paid via scheduled transfer. RFQ on HCS. Seed data for two facilities. Publish walkthrough page, onboard early adopters (feedback cycle 3). |
| 5 | 9 | Incorporate feedback, freeze and pause demo, HashPack observer connect, README with architecture, HashScan links, and feedback changelog, five-minute video, submission. |

### Definition of Done (what "fully functional" means for each feature)

The Execution rubric's 5 requires a fully functional solution, not a proof of concept. Each feature has an acceptance test the demo video shows.

| Feature | Done when |
|---------|-----------|
| ATS issuance | Facility token visible on HashScan. Three lenders verified in the identity registry. A transfer to a fourth, unverified account reverts with a compliance error shown in the UI. |
| HTS stablecoin | Token on HashScan with KYC, freeze, and pause keys. KYC grant happens in the same action as identity registry verification. Transfer to a non-KYC'd account fails. |
| Settlement engine | `settle` reverts if either approval is missing, if either allowance is short, or if the buyer's KYC was revoked between approval and settlement. Foundry tests cover all four paths. Contract verified on HashScan. |
| Scheduled settlement | Schedule entity visible on HashScan before execution with its calldata. Executes at the settlement time without any off-chain trigger. Both balances change in the same consensus timestamp. |
| Privy quorum | A single trader cannot approve. Compliance and PM approvals unlock the signature. The approvals inbox shows who approved and when. |
| CRE accrual | Workflow log shows the notice was consumed with terms redacted. `InterestDistributor` holds per-holder amounts. Scheduled transfer pays every holder pro-rata on the payment date after the paying agent signs. |
| RFQ | Request, quote, accept, confirm each produce an HCS message with a consensus timestamp shown in the blotter. |
| UX | A judge can complete a trade end-to-end from the README in under five minutes with no seed phrase, no HBAR, and no CLI. |

### UX Principles

The Execution rubric explicitly scores UI/UX. Institutional users judge software by how little it makes them think.

- **No crypto vocabulary in the interface.** Par, price, settlement date, counterparty, approvals. Never "gas", "sign transaction", "approve token", or "wallet".
- **No HBAR for users.** The venue operator account pays network fees. Users log in with email through Privy and never fund anything.
- **Every action has a receipt.** Each state change shows a HashScan link inline. Institutions trust what they can audit.
- **The blotter is the home screen.** Traders live in a blotter. Open RFQs, pending approvals, scheduled settlements, and completed trades in one view.
- **Approvals are an inbox, not a modal.** Compliance and PM approve from a queue with the trade details and the compliance check result visible.
- **Errors say what to do.** "Buyer is not an eligible assignee for this facility. Request KYC verification." not "Transaction reverted."

### Team Roles

| Member | Role | Key Responsibilities |
|--------|------|---------------------|
| Founder | Everything | Contracts, integration, front end, demo, pitch. Time-boxing is the leadership skill that matters here: each feature has a fallback and a cut line. Daily plan above is the strategy; the Definition of Done table is the quality bar. |

### Design Decisions

| Decision | Options Considered | Choice | Rationale |
|----------|-------------------|--------|-----------|
| Loan register representation | HTS native fungible token with KYC key; ATS ERC-1400 only; ATS ERC-3643 | ATS ERC-3643 | Track requires ATS. ERC-3643 gives an on-chain identity registry and pluggable compliance, which is what assignee eligibility needs. HTS native KYC is a binary flag with no rule engine. |
| Facility vs tranche granularity | One token per facility with ERC-1410 partitions per tranche; one token per tranche | One token per tranche for the hackathon | Simpler to reason about and to display. Partitions are the right v2 design for facilities with many tranches and are supported by ATS. |
| Cash leg | HBAR; existing testnet stablecoin; own HTS permissioned token | Own HTS permissioned token | Need KYC and freeze on the cash leg to mirror the asset leg. HTS keys give that natively. |
| Atomic DvP mechanism | (a) Scheduled Transaction wrapping a batch of both legs; (b) HIP-551 atomic batch of two natively signed legs; (c) single `settle` contract call, scheduled | (c) | (a) is not possible: a schedule wraps one transaction body and a batch cannot be scheduled. (b) works and is elegant, but inner transactions expire 180 seconds after their valid start, which conflicts with hours-long quorum approvals. (c) keeps atomicity inside one EVM execution, keeps Scheduled Transactions for the settlement date, and gives a verifiable contract on HashScan. (b) is documented as a stretch alternative. |
| Who schedules settlement | Backend via SDK; contract via HSS `scheduleCall` (HIP-1215) | Contract, with SDK fallback | The contract scheduling its own settlement is the non-obvious integration judges reward and removes an off-chain dependency. |
| Trade approval | On-chain multisig contract; Hedera threshold key on a per-trade escrow account; Privy quorum policy gating the desk wallet | Privy quorum | Matches how desks actually work (roles, not keys). Per-trade threshold-key accounts are clunky. Keeps the approval policy off-chain and private, which institutions prefer. |
| Interest computation | On-chain from public terms; off-chain by the venue; CRE confidential workflow | CRE confidential workflow | Loan terms are private. Public on-chain computation leaks the spread. Venue computation is a trusted third party. CRE keeps the terms private and the result verifiable. |
| Market structure | Order book; RFQ | RFQ | Loans trade bilaterally. RFQ is realistic and needs no matching engine. |
| Front end | Extend ATS web app; custom app on ATS SDK | Custom app | ATS web app is a token admin panel. Traders need a blotter and portfolio view. The SDK is the reusable part. |

### Post-Hackathon Roadmap

- **Month 1-2:** Present to the LSTA technology and innovation working group. Five conversations with loan operations leads at CLO managers and agent banks. Implement the deemed-consent window for assignee eligibility. Replace mock KYC with a provider integrated through ATS external KYC lists.
- **Month 3-6:** Design partner pilot with one CLO manager and one agent bank on a shadow register (tokenised mirror of a real facility, no legal transfer of ownership). Legal opinion on the token structure. Integration with ClearPar or LoanIQ as a settlement instruction source. Upstream the settlement engine and RFQ module to ATS.
- **Month 6-12:** First legally binding tokenised assignment under a participation or assignment agreement. Multi-tranche facilities using ERC-1410 partitions. Production key management (Fireblocks or HSM through ATS integrations). Regulated stablecoin as the cash leg.

---

## 8. Validation Strategy

Institutional finance does not produce hackathon-style validation. No agent bank signs a letter of interest in five days, and no CLO manager runs a paid trial of a testnet demo. The rubric's top marks (paid trials, revenue, churn) are written for accelerator-stage companies. What a hackathon project in this market can show is an evidence hierarchy: documented market demand, expert feedback on the design, and real users onboarded to the testnet product. This section builds all three.

### Tier 1: Market Demand Already Validated (public evidence)

The problem and the shape of the solution are validated by institutions spending real money on them. Cite these in the pitch as market validation; they are stronger than any hackathon survey.

| Evidence | What it validates | Source |
|----------|------------------|--------|
| Versana: BofA, Citi, JPMorgan and others funded a shared loan data platform; $900B+ across 1,500+ facilities | Banks will fund shared infrastructure for syndicated loans | Versana press releases |
| LSTA delayed compensation rules and settlement-time reporting | The market measures and pays for its own settlement delay; the pain is quantified by the industry body itself | LSTA secondary trading reports |
| Galaxy Digital $75M tokenised CLO (Jan 2026) | Institutional holders will take tokenised leveraged-loan exposure | Galaxy announcement |
| JPMorgan Kinexys, Broadridge DLR ($1T+ monthly), HQLAx, Goldman DAP | Tier-1 banks already run atomic DvP for collateral on DLT; the mechanism is accepted | Company disclosures |
| Hedera council banks and ATS partner issuers (ioBuilders, RedSwan) | Regulated issuers already tokenise on Hedera through ATS | Hedera docs |

### Tier 2: Expert Feedback Cycles (during the hackathon)

These are the people who can be reached in five days and whose feedback carries weight with judges.

| Source | Why they count | How to reach | Ask |
|--------|---------------|-------------|-----|
| Contacts from four years of institutional OTC infrastructure now on credit, loan, or operations desks | Practitioners who execute or settle loan trades | Direct message, 15-minute call or async video review | Does the approval flow match your desk? What breaks in the settlement flow? What would stop you running a shadow register? |
| Privy and Chainlink engineers at the hackathon | Subject-matter experts for the quorum and confidential-compute integrations | Sponsor office hours, Discord | Is the quorum policy the right primitive? Is the confidential workflow the intended use of CRE? |
| ATS maintainers | Owners of the platform this extends | GitHub issue on hashgraph/asset-tokenization-studio, Hedera Discord | Review the settlement engine as an upstream extension. Any objections to the ERC-3643 register mapping? |
| Hedera Foundation enterprise or DeFi team | Know which council members care about this | Hackathon mentors | Which institutions should see this first? |

### Tier 3: Early Adopters Onboarded (testnet users)

The product can onboard real users during the hackathon. Observers are a legitimate user class: auditors and risk teams read registers without trading.

- Publish the testnet demo with a guided walkthrough by day 4.
- Onboard judges, mentors, sponsor engineers, and Hedera community members as observers through HashPack, and as simulated desk users through Privy.
- Track sign-ups, completed walkthroughs, and feedback submitted through an in-app form. Report the counts in the pitch.
- Target: 10 to 20 onboarded testnet users with at least 5 structured feedback responses by submission.

### Validation Milestones

| Milestone | Target | Timeline |
|-----------|--------|----------|
| Practitioner design reviews | 3 practitioners from the founder's network review the day-3 demo and answer three structured questions | Days 3 to 5 |
| Sponsor SME reviews | Privy and Chainlink engineers confirm the integration pattern is sound | Days 2 to 4 |
| ATS maintainer engagement | GitHub issue opened describing the secondary market extension; maintainer response received | Days 3 to 5 |
| Testnet early adopters | 10 to 20 users onboarded, 5 structured feedback responses | By submission |
| Feedback incorporated | At least two changes made in response to feedback, documented in the README changelog | Day 5 |
| Shadow-register conversations | 3 institutions in active discussion | 4 weeks after submission |
| LSTA working group presentation | Demo presented | 8 weeks after submission |
| Shadow register pilot | 1 facility mirrored with 2 participants; settlement time measured against the same trades' real settlement | Month 3 to 6 |

### Market Feedback Cycles

1. **Cycle 1 (days 2 to 3):** Sponsor SMEs review the integration design before it is built out. Adjust the quorum and CRE patterns based on what they say.
2. **Cycle 2 (days 3 to 5):** Practitioners review the rough demo. Fold the answers into the day-5 polish. Document what changed. Quote them in the pitch, anonymised by role.
3. **Cycle 3 (days 4 to 5):** Testnet early adopters complete the walkthrough and submit feedback in-app. Fix the top friction point before recording the final video.
4. **Cycle 4 (post-submission):** Shadow-register pilot measuring real settlement-time reduction on real trades.

### What to Say in the Pitch

"We spoke to N practitioners who settle loan trades. Every one of them described the same three-week process. Two of them told us our approval flow matches how their desk actually works, and one told us it doesn't, so we changed it. The market itself has already validated the demand: three of the largest banks funded Versana, and JPMorgan and Broadridge already run atomic DvP for collateral. Nobody has done it for the loans themselves."

---

## 9. Go-To-Market Strategy

### Target Market

- **TAM:** Global syndicated loan market, several trillion dollars outstanding. Secondary trading volume of roughly $1T per year in the US alone.
- **SAM:** US leveraged loan secondary market. $1.4T outstanding, $1T annual trading, 300k to 400k tickets per year. Settlement fees at 1 to 2 basis points of par imply a $100M to $200M annual fee pool.
- **Initial Target Segment:** CLO managers and credit funds trading US leveraged loans. They trade most, suffer most from delayed settlement, and have the fewest legacy system constraints.

### Distribution Channels

1. **Industry body first.** The LSTA sets the rules the market runs on. A working demo presented to its technology group is the fastest path to credibility with every member firm.
2. **Direct to loan operations.** Operations leads feel the pain daily and can sponsor a shadow-register pilot without a trading mandate change.
3. **Integrate with incumbents.** ClearPar and LoanIQ already hold the settlement instructions and the register data. Position SyndicateLend as the settlement layer under them, not a replacement.
4. **Hedera enterprise network.** The Hedera Foundation and council members include financial institutions; ATS partners such as ioBuilders already serve tokenised bond issuers.

### Growth Strategy

- Land with shadow registers (no legal transfer), which need no regulatory change and prove the settlement-time reduction with real trades.
- Expand to legally binding assignments once one agent bank accepts the token as the register of record for one facility.
- Each agent bank that adopts brings every lender in every facility it agents. Network effects run through the agent bank, so the sales motion targets them second, after demand is shown from the buy side.
- Partnership opportunities: ClearPar (settlement instructions), Versana (reference data), KYC providers through ATS external lists, regulated stablecoin issuers for the cash leg.

---

## 10. Pitch Outline

Five minutes total. Hedera must be visible as the reason the solution works, not a deployment target.

1. **The Problem (30 sec):** "A fund sells $5M of a term loan to an insurer. They agree the price in ten minutes. The trade settles in three weeks. The market is so used to this that it built a compensation scheme to apologise for it. $1T of these trades happened last year."
2. **The Solution (60 sec):** Show the register on HashScan. Show an RFQ agreed in the blotter. Show two desks approving through Privy quorum. Show the scheduled settlement sitting on HashScan before it executes. Show it execute: both legs in one transaction. "Three weeks became one day, and the compliance check ran inside the transfer."
3. **Hedera Integration (45 sec):** ATS gave us an audited compliant register on day one. Scheduled Transactions let the trade schedule its own settlement with no bot. HTS gave the cash leg the same KYC controls as the asset. HCS is the audit trail. CRE computed interest on private terms and Hedera paid every holder. "Five services, each doing a job that would otherwise be a custom contract or an off-chain server."
4. **Traction (30 sec):** Practitioner feedback quotes from the hackathon cycle. ATS maintainer feedback. Interest from the LSTA working group if obtained. Be honest about stage.
5. **The Opportunity (30 sec):** $1.4T outstanding, $1T traded per year, fee pool of $100M to $200M at incumbent settlement pricing. Versana proved institutions will share data; Galaxy proved they will hold credit on-chain. Nobody has moved ownership on-chain yet.
6. **The Ask / Next Steps (15 sec):** Introductions to agent banks and CLO managers for a shadow-register pilot. Upstream the settlement engine to ATS.

### Key Metrics to Present

Every number on a slide gets a source in the footer. The Pitch rubric's 5 requires cited data.

| Metric | Value | Source |
|--------|-------|--------|
| US leveraged loans outstanding | $1.4T | LSTA, PitchBook LCD |
| US secondary loan trading volume 2025 | $1T (record) | LSTA secondary trading report |
| Trade tickets per year | 300k to 400k | LSTA (confirm exact figure) |
| Median par trade settlement time | roughly T+20 (confirm exact figure) | LSTA settlement statistics |
| Settlement time on SyndicateLend | T+1, configurable to T+0 | Own demo, HashScan timestamps |
| Delayed compensation avoided per $5M trade at 19 days | Compute from LSTA formula for the pitch | LSTA delayed compensation rules |
| Hedera transactions per trade and per interest period | About 10 and 20 to 40 | Own data, HashScan links |
| Full-market account and transaction projection | 8k to 12k accounts, 15k to 20k tx/day | Section 4 model |
| Settlement fee pool at incumbent pricing | $100M to $200M per year | 1 to 2 bp on $1T volume |

### Anticipated Judge Questions

| Question | Answer |
|----------|--------|
| Why not a private chain like the banks use? | Private chains work when one bank runs them for its own clients. A syndicated loan has 150 lenders and no natural operator. A public network with permissioned tokens is the only structure where the register is neutral. Hedera's council governance is the closest thing to a consortium a public chain offers. |
| Why Hedera over Ethereum? | Three things Hedera has natively that would be custom escrow contracts elsewhere: Scheduled Transactions for deferred, on-chain-visible settlement; HTS compliance keys on the cash leg; and ATS, which gave us an audited ERC-3643 register on day one. Fixed fees matter for institutions that need to budget. |
| Is a loan token a security? | A loan piece is already a financial instrument transferred under LSTA assignment or participation agreements. The token represents the same interest under the same agreement. ERC-3643 was designed for exactly this compliance model. Legal opinion is roadmap month 3. |
| Who is the issuer of the token? | The agent bank, which already keeps the register. SyndicateLend is the tooling; the agent bank holds the issuer role in ATS. Shadow registers let an agent bank mirror a facility before it commits to the token as the register of record. |
| Why does the interest computation need a TEE? | Spread, day-count, and reset terms are private between borrower and lenders. Computing on-chain leaks them. Computing at the venue makes the venue a trusted party. CRE confidential compute keeps the terms private and the result verifiable. |
| How does a user get HBAR? | They don't. The venue operator pays fees. Users log in with email. |
| What happens if the buyer loses eligibility between approval and settlement? | ERC-3643 compliance runs inside `settle`. The transfer reverts, neither leg moves, the trade is flagged in the blotter. No partial state, no unwind. |
| What about the 180-second transaction validity window? | That is why settlement is a scheduled contract call rather than an atomic batch of two signed transactions. Approvals can take hours; the schedule waits. |
| Why solo? Can you execute? | Four hackathon wins in the past year, one of which is in external audit. Four years building institutional OTC infrastructure. The daily plan and Definition of Done in the PRD are the execution strategy. |
| What is the business model? | Per-trade settlement fee in basis points, which the market already pays ClearPar. Facility onboarding and register maintenance fees paid by agent banks. |

### Demo Video Shot List (5 minutes max)

| Time | Shot |
|------|------|
| 0:00 | Problem in one sentence over a HashScan view of the empty register |
| 0:30 | Issue facility token via ATS, register three lenders, grant KYC, show a rejected transfer to an unverified account |
| 1:30 | RFQ: request, quote, accept in the blotter; HCS topic view |
| 2:15 | Privy quorum: trader submits, compliance approves, PM approves, wallet signs |
| 2:45 | Scheduled settlement visible on HashScan; executes; both balances change |
| 3:30 | Interest: CRE workflow log (terms redacted), distribution scheduled, paying agent signs, holders paid |
| 4:15 | Freeze on default, pause on amendment |
| 4:40 | Architecture slide, repo link, HashScan links |

---

## Parking Lot (Future Ideas)

- **Deemed-consent window.** Time-bound borrower consent on assignee eligibility, matching LSTA rules, implemented as a compliance module in ERC-3643.
- **ERC-1410 partitions for multi-tranche facilities.** One ATS security per facility, one partition per tranche.
- **HIP-551 atomic batch settlement.** Two natively signed legs submitted as one batch, for desks with fast approval. Removes allowances and the settlement contract from the critical path.
- **Repo collateral.** Post loan tokens as collateral against an HTS stablecoin loan, with programmatic release. Directly addresses the track's first idea.
- **Loan marks via CRE.** Same workflow delivers daily marks from a pricing source for portfolio valuation and NAV.
- **Upstream to ATS.** Package `SettlementEngine` and the RFQ module as an ATS "secondary market" extension with a pull request to the ATS repo.
- **Agent bank console.** Register management view for the agent bank: amendments, waivers, holder reports, snapshot at record date.
- **Delayed compensation calculator.** Show, per trade, how much delayed comp would have accrued under LSTA rules versus zero on SyndicateLend. Strong pitch metric.

---

## Section-to-Criteria Mapping

| PRD Section | Judging Criteria Addressed |
|-------------|---------------------------|
| 1. Problem Statement | Feasibility, Pitch |
| 2. Solution Overview | Innovation, Pitch, Execution |
| 3. Hedera Integration | Integration (primary), Innovation |
| 4. Network Impact | Success (primary) |
| 5. Innovation | Innovation (primary) |
| 6. Feasibility & Business Model | Feasibility (primary) |
| 7. Execution Plan | Execution (primary) |
| 8. Validation Strategy | Validation (primary) |
| 9. Go-To-Market | Execution, Success |
| 10. Pitch Outline | Pitch (primary) |
