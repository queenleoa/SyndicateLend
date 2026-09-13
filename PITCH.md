# SyndicateLend — pitch

**One line.** A private tokenised register and RFQ secondary market for syndicated-loan interests on Hedera, where a trade settles as one atomic, compliance-checked transaction instead of a weeks-long reconciliation.

**Who.** Built by Adrija, founder of [Fullmetal Finance](https://fullmetal.finance), which builds collateral and settlement-efficiency products for institutional finance, including a full-stack OTC derivatives solution. Four years in institutional OTC derivatives infrastructure. Solo build in five days for the Hedera hackathon, ATS track.

## Problem

Syndicated loans are one of the largest credit markets in the world: the Morningstar LSTA index approached US$1.5 trillion outstanding in 2025 and US secondary trading hit a record US$971 billion. A loan interest is not a security. It is a contractual claim, transferred by assignment through an administrative agent's register, with eligibility and consent checks, documents, and a cash leg on a separate rail. LSTA's 2025 settlement study still shows par trades settling in the mid-to-high teens of business days. The market even has a delayed-compensation regime to allocate the cost of missing the settlement date. Every day of delay is counterparty exposure, trapped capital and reconciliation work.

## Solution

SyndicateLend puts ownership, eligibility, payment and evidence in one workflow:

1. **Register**: one credit agreement, one Asset Tokenization Studio security per facility or tranche, issued from the ops scripts or from the browser wizard. Eligible lenders only; a transfer to an unverified account reverts.
2. **Market**: the RFQ workflow desks already use, with every event ordered on a Hedera Consensus Service topic.
3. **Institutional approval**: Privy quorum wallets. A trader cannot move the desk's assets alone; two of three quorum members must sign (named staff for the institutions in the video; trader, automated compliance co-signer and a reserve key for a self-service judge desk).
4. **Settlement**: `SettlementEngine` exchanges the loan token and mock USD atomically, scheduled by the Hedera Schedule Service from inside the contract. A buyer whose eligibility is revoked before execution causes a full revert with the reason on-chain.
5. **Interest**: the agent commits a salted hash of its private rate notice to HCS; a Chainlink CRE confidential workflow verifies the notice in a TEE, computes each holder's accrual, and releases only the distribution, which the paying agent settles in one HTS transfer.

Everything above runs on Hedera testnet today. Ids, HashScan links and reproduction scripts are in the [README](README.md).

## Why this is more than tokenised private credit

Tokenised private credit (fund tokens, tokenised notes, tokenised CLOs) wraps *exposure* to loans in a token. The loan itself still settles the old way behind the wrapper. SyndicateLend tokenises the *assignment itself* at the agent-register level and makes the settlement of that assignment atomic and compliance-aware. The detailed comparison is in [HACKATHON-PRD.md §2.5](HACKATHON-PRD.md#25-why-this-is-more-than-tokenised-private-credit).

## Validation so far

- Syndicated-loan institutions in India, including ICICI Bank, HDFC Bank and State Bank of India, have indicated interest to Fullmetal Finance in solutions that make syndicated loans easier to manage alongside its OTC derivatives stack. These are expressions of interest, not contracts; see [docs/validation.md](docs/validation.md).
- Engineering validation on testnet changed the design twice: the Hedera scheduled-execution timing edge (now a schedule margin in the engine) and the ATS `forcedTransfer` versus `transferFrom` decision.

## What Hedera gains

Not throughput. On the README's labelled assumptions, one agent's book puts US$120bn of loan par on an ATS register, settles US$4bn a year through the engine and pays US$8.7bn a year of interest through HTS, at about US$4m of value per settlement or payout transaction; at the scale Versana reports it is US$900bn on-register. The cash leg brings institutional payment-token balances onto the ledger on every settlement and payment date. And a loan position that settles atomically becomes collateral: it can be pledged for secured funding or OTC derivatives margin on the same ledger, which is the business Fullmetal Finance already runs. Institutional collateral is measured in hundreds of billions before a single retail account exists. The topology is institutions on HashSphere and retail on public Hedera, with the feeder as the bridge, and the retail layer is built, not projected: 25 feeder holders were onboarded on public testnet as KYC-gated register positions and paid by the same accrual workflow in four atomic batches. Extrapolated with labelled assumptions, one in ten facilities with a 5,000-holder feeder is about 750,000 public-network accounts and 9m interest transfers a year. Details in the README's "Network impact".

## Business model

Settlement fee per completed trade, facility onboarding fee, annual register-maintenance fee and an interest-distribution service fee. Pricing is a hypothesis to be tested in the pilot. [Lean canvas](docs/lean-canvas.md).

**First pilot target**: the agency desk of one Indian private-sector bank running one term-loan facility with three to six lenders as a *shadow register* for one quarter, reconciled daily against the agent's books. No core-system change; a read-only lender-register feed and two operations staff for roughly two hours a week.

## The ask

- One administrative agent and one loan investor for the shadow-register pilot.
- Hedera: guidance on a HashSphere private deployment with the same transaction shape as the testnet demo.
- Chainlink: Confidential Workflows access to move the accrual from the local simulator to a deployed enclave.
- Introductions to loan-operations practitioners to answer the open design questions in the PRD §11.

## Demo

Five-minute flow in the [README](README.md#five-minute-demo-mode). Every on-chain claim is reproducible from the `ops/` scripts without a Privy login.
