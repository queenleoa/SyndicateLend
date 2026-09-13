# SyndicateLend

[![ci](https://github.com/queenleoa/SyndicateLend/actions/workflows/ci.yml/badge.svg)](https://github.com/queenleoa/SyndicateLend/actions/workflows/ci.yml)

Private tokenised register and RFQ secondary market for syndicated-loan interests on Hedera. Built by the founder of [Fullmetal Finance](https://fullmetal.finance) (collateral and settlement-efficiency products for institutional finance) for the Hedera hackathon, ATS track.

**Read first:** [PITCH.md](PITCH.md) (problem, solution, validation, ask) · [HACKATHON-PRD.md](HACKATHON-PRD.md) (full spec, status at submission in §8.5) · [docs/validation.md](docs/validation.md) · [docs/lean-canvas.md](docs/lean-canvas.md)

## Why settlement needs to change

A syndicated loan has one borrower, one credit agreement and many lenders. Selling a lender's position requires an assignment: documents, eligibility checks and any required consents must be completed before the administrative agent records the new lender. Electronic trading and document workflows accelerate individual steps, but the agent's ownership register and the bank-wire payment remain separate. Agreeing a price is not the same as completing the transfer.

**Only 29% of par loan trades settled within T+7; 27% took longer than T+20** in LSTA's 2021 commentary. The delay leaves sellers waiting for proceeds and both parties exposed to non-performance. [Source: LSTA, Risk Management 101](https://www.lsta.org/university/operations/).

![Historical par loan settlement: 29% within seven business days, 44% in eight to twenty days, and 27% beyond twenty days.](docs/assets/loan-settlement-times.svg)

For loan funds offering daily redemptions, waiting weeks for sale proceeds creates a liquidity mismatch. Cash buffers and credit lines bridge that gap, tying up capital or adding funding costs.

SyndicateLend brings the digital lender register and payment into one controlled transaction. Fast execution begins **after** the required legal consents and approvals; tokenisation does not waive them.

## Core workflow

- **Register:** one credit agreement, several Asset Tokenization Studio (ATS) securities under it (Term Loan B tranches, the revolver, the delayed-draw facility, and anything issued from the browser wizard); each is a bond-type diamond with a whitelist control list and internal KYC. 1 token = US$1 par.
- **Payment leg:** permissioned HTS mock-USD token (KYC, freeze, pause keys held by the administrative agent).
- **Settlement:** `SettlementEngine` exchanges loan tokens and mock USD atomically in one contract call, scheduled through the Hedera Schedule Service (HIP-1215 `scheduleCall`). Any compliance, balance or allowance failure reverts both legs and records the reason on-chain.
- **Approvals:** Privy quorum-controlled desk wallets, 2-of-3 for every institution (Day 3). The venue keeps each desk wallet above 8 HBAR so Privy-signed transactions can reserve gas.
- **Interest:** agent commits a salted hash of the private rate notice to HCS; a Chainlink CRE confidential workflow verifies it in a TEE, computes accrual and releases only the distribution; the paying agent settles it in one atomic HTS transfer (Day 4).

## What is new here

An **assignment** makes the buyer a lender of record. A **participation** passes through the loan's economics while the seller remains on the register, leaving the participant exposed to the seller as well as the borrower. SyndicateLend targets the underlying assignment, not just a pass-through claim.

Tokenised private credit (Maple, Centrifuge, Figure, tokenised CLOs) wraps *exposure* to loans in a token; the loan still settles the old way behind the wrapper. SyndicateLend tokenises the **assignment itself** on the agent's register and makes its settlement atomic and compliance-aware. Specifically:

1. **In-contract scheduling, contract as payer.** The engine calls HSS `scheduleCall` (HIP-1215) itself on the second approval and funds the scheduled execution. No keeper.
2. **Revocation triggers a full revert at execution.** Compliance can revoke a buyer after both approvals; the scheduled settlement fails as a whole with the ATS reason stored on-chain. `transferFrom`, not `forcedTransfer`, so the check cannot be bypassed.
3. **Commitment-verified confidential accrual.** Salted hash on HCS; Chainlink CRE verifies the private notice in a TEE and releases only per-holder amounts; a tampered notice aborts.
4. **User-bound institutional quorum.** Privy key quorums own each desk wallet under a policy limited to the venue contracts (2-of-3 named staff for the institutions in the video; 2-of-3 of trader, automated compliance co-signer and a reserve key for self-service judge desks); the app secret alone cannot move assets.
5. **The market's own workflow.** RFQ, not an order book; an agent-centred register, not a fund wrapper.
6. **Integration with the agent's book, not around it.** A register-reconciliation adapter that ingests the agent's own export and attests only a report hash on HCS, and an LSTA-vocabulary assignment export, so the shadow-register pilot needs no re-keying. See "Integration hooks" below.

The comparison table is in [HACKATHON-PRD.md §2.5](HACKATHON-PRD.md#25-why-this-is-more-than-tokenised-private-credit).

## Judging the web app

The app has four workspaces: **Institution** (the desk's Privy wallet, its 2-of-3 approval policy and team, and wallet setup shown as three phases: network setup by the agent bank, the desk's three signatures, funding), **Loan registry** (the agent bank's view: one credit agreement, every asset issued under it, each asset's lenders and interest, transfer requests, interest and payments, administration), **Secondary exchange** (execution room, RFQ trading and desk approvals) and **Positions** (a desk's par by asset, cash, trades and accruals).

The agent-bank walkthrough is four browser steps, no terminal ([docs/loan-registry-demo.md](docs/loan-registry-demo.md)):

1. **Issue an asset.** The wizard creates a new ATS security under the Meridian Holdings credit agreement, allowlists and KYC-checks each syndicate lender, issues its par, and commits the private rate notice as a salted hash on HCS. Every step shows its Hedera receipt.
2. **Loan register.** The new asset appears at the top beside the assets already on the register: the pre-issued Term Loan B Tranche A (`MHTLB-A`), the revolver (`MH-RCF`) and the delayed-draw facility (`MH-DDTL`) from `ops/deployments/testnet.json`, plus every tranche issued earlier from the wizard (Tranches B and C at the time of writing). Each shows its lender register read live from the ATS security through `RegisterSnapshot`. The agent bank is always the platform's operator account; the signed-in institution is a syndicate lender on the assets it holds.
3. **Approve a transfer.** One click asks two automated institutions to agree a US$1m assignment on the HCS market; the agent bank reviews and approves it; both institutions sign with their own automated Privy quorums; the Hedera Schedule Service settles both legs.
4. **Interest.** Every asset carries a committed rate notice; the register shows the CRE-released amounts and payout receipts per lender, or the agent bank's estimate until the next confidential run. **Interest & payments** (`/lifecycle`) puts the released distribution and payout first (computed, paid, outstanding, receipts, one row per holder with the 25 retail feeder wallets grouped), then the five-stage confidential pipeline and the commitment and simulation evidence.

Any email can sign in and gets its own institution at once. Its Privy key quorum is 2-of-3: the signed-in trader, the venue's automated compliance co-signer (a server-held P-256 key) and a reserve key minted for that desk (public half only, so the venue holds one key of three and can never execute alone). The judge signs once in the browser, the venue co-signs after checking the intent, and the wallet policy still limits everything to the venue contracts. The named institutions in the video keep their 2-of-3 human quorums. The operator side of Hedera onboarding runs automatically from any page load. An automated liquidity desk (Aldgate, two server-held keys, labelled as automated) always has a buy and a sell RFQ open, quotes within a minute, accepts the best quote it receives and approves its own side, so a judge can also trade end to end. A configured email group gets a **Reset desk** button for iterating. See [docs/demo-runbook.md](docs/demo-runbook.md).

Every on-chain claim below is also reproducible without a login from the `ops/` scripts against the committed ids in `ops/deployments/testnet.json`, and every artefact links to HashScan. CI runs the 21 Foundry tests, `tsc --noEmit` for ops and web, and eslint on each push.

## Live on Hedera testnet (Day 1, 2026-09-10)

| Artefact | Id | Inspect |
|---|---|---|
| Term Loan B Tranche A `MHTLB-A` (ATS bond-type security, Reg S, whitelist + internal KYC; the tranche wired to the secondary market) | `0.0.10459721` / `0x1600f4a4609b9e9c48c432a16732da2634b7b1b7` | [HashScan](https://hashscan.io/testnet/contract/0.0.10459721) |
| Revolving Credit Facility `MH-RCF` (ATS security, 60,000,000 par, register-only) | `0.0.10520474` / `0xbfb63219860760f570723ee1dba9873cd9723f7f` | [HashScan](https://hashscan.io/testnet/contract/0.0.10520474) |
| Delayed Draw Term Loan `MH-DDTL` (ATS security, 40,000,000 par, register-only) | `0.0.10520523` / `0x715d682dc4bd7e73a1919b6929361bc771c6b348` | [HashScan](https://hashscan.io/testnet/contract/0.0.10520523) |
| Tranches issued from the browser wizard (`MHTLB-B`, `MHTLB-C`, …) | recorded per issuance in the app's durable store | listed with receipts on the Loan register |
| SettlementEngine (Sourcify exact match) | `0.0.10460134` / `0x593D401cF80FAE8422a5aA113075cD2F464c297F` | [HashScan](https://hashscan.io/testnet/contract/0.0.10460134) |
| Mock USD (HTS, KYC / freeze / pause keys) | `0.0.10459660` | [HashScan](https://hashscan.io/testnet/token/0.0.10459660) |
| HCS RFQ topic | `0.0.10459663` | [HashScan](https://hashscan.io/testnet/topic/0.0.10459663) |
| HCS notice-commitment topic | `0.0.10459666` | [HashScan](https://hashscan.io/testnet/topic/0.0.10459666) |
| Administrative agent | `0.0.10457020` | [HashScan](https://hashscan.io/testnet/account/0.0.10457020) |
| RegisterSnapshot (one-call holder balances for the enclave) | `0x33687eBC6C3f8A89DbE60ADc3E631149dA6E0690` | [HashScan](https://hashscan.io/testnet/contract/0x33687eBC6C3f8A89DbE60ADc3E631149dA6E0690) |

### Settlement evidence (Day 2 core, same day)

| Scenario | Result | Evidence |
|---|---|---|
| Trade 1: 5,000,000 par @ 99.00 for 4,950,000 mUSD, both desks approved, executed by the network's scheduled call at `settleAt` | **Settled**, both balances moved in one transaction | [schedule 0.0.10460165](https://hashscan.io/testnet/schedule/0.0.10460165), [seller approval that created the schedule](https://hashscan.io/testnet/transaction/0x47f5ef71d24a1bb98cc417d39aa968d0f1c9ab632f12e88e1bdd41c603272ae2) |
| Trade 2: 50,000 par, buyer eligibility revoked by the compliance officer after both approvals | **Failed**, no balance changed, reason `AccountIsBlocked(buyer)` stored on-chain | [schedule 0.0.10460221](https://hashscan.io/testnet/schedule/0.0.10460221), [revocation](https://hashscan.io/testnet/transaction/0x4a80a85584441082f60f6da79222bfa7b9a536794a8de7deba60957ebe0ebf53) |

Reproduce with `npm run settle-demo -- --delay 120` and `npm run settle-demo -- --par 50000 --delay 90 --revoke-buyer` in `ops/`. The first engine deployment (`0.0.10459674`) exposed a timing edge: the network fires a schedule at its expiry second, but the EVM block timestamp can lag it by a fraction, so the engine now schedules `settleAt + 10s` (never earlier than `settleAt`). That trade was settled manually and is kept as a record.

Three eligible lenders hold the tranche (seller 150m par, holder 100m par, buyer 0 par with 10m mock USD). Restriction evidence: a [loan transfer to an unverified account reverted](https://hashscan.io/testnet/transaction/0xd59ce30c7a35ed6ba2bd71a48735dcfaa986c9d649c12e5f6b95550e819b6255) and a mock-USD transfer to it failed with `ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN`. ATS also refused to issue to the desks before they were whitelisted. Reproduce with `npm run negative-test` in `ops/`.

## Repository layout

| Path | Contents |
|---|---|
| `contracts/` | Foundry project: `SettlementEngine.sol`, HSS interface, tests with ATS/HTS/HSS doubles |
| `ops/` | Administrative-agent scripts (ATS SDK + Hedera SDK): issuance, KYC, allocation, mock USD, HCS topics |
| `ops/deployments/testnet.json` | Addresses and ids written by the scripts (committed so judges can inspect) |
| `ops/samples/`, `ops/reports/`, `ops/exports/` | Agent register export sample, reconciliation reports and assignment exports produced by the integration adapters |
| `ops/src/feeder-demo.ts` | Retail feeder holders on public testnet (account driver); keys in gitignored `ops/.feeder-keys.json` |
| `web/` | Institutional web app (Day 3) |
| `cre/` | Chainlink CRE confidential workflow (Day 4); `cre/evidence/` holds the sanitised simulation results, released distribution and payout receipt |
| `docs/` | Validation record, Lean Canvas, Privy dashboard settings, demo runbook, loan-registry walkthrough, issuance guide, wallet-setup recovery |
| `web/scripts/` | Provisioning (`provision.mts`, `provision-automated-desk.mts`), Hedera onboarding by hand (`hedera-onboard.mts`), one market tick (`market-tick.mts`), intent inspection, and the offline test suites (`*.test.mts`) |
| `.github/workflows/ci.yml` | forge test, typecheck and lint on every push |

## Five-minute demo mode

The web app opens on an **Execution room** that combines the current RFQ, Privy quorum progress, Hedera schedule, ATS register and CRE lifecycle status. Keep a second terminal running the counterparty agent during the recording; it watches the real HCS topic and responds to any open RFQ from another institution:

```bash
# terminal 1
cd web && npm run dev

# terminal 2, from the repository root
npm run demo:counterparty -- --institution halcyon --price 99.00
```

Recommended recording flow:

1. Sign in as Meridian's trader and show the ATS security and eligible-holder register.
2. Publish a $5m sell RFQ. The counterparty terminal detects it and Halcyon appears as a priced response on the HCS-backed blotter.
3. Accept the quote. The Execution room now shows the immutable instruction and two institutional mandate lanes.
4. Open each institution's real Privy members in separate browser profiles and demonstrate that one signature is insufficient, while the second executes the desk intent.
5. Show the resulting Hedera scheduled transaction and atomic loan/mUSD settlement receipt.
6. Open **Interest & payments** to show the released distribution and payout, the public HCS commitment, the valid calculation and the altered-notice rejection. Run `npm run demo:cre` beforehand to capture the simulation results for this screen.

The counterparty process submits RFQ quotes only. It cannot authorize either desk wallet and does not bypass Privy's user-bound 2-of-3 policy.

## Prerequisites

- Node 20+ (tested on 25), Foundry
- A Hedera **testnet ECDSA** account with HBAR. Register at <https://portal.hedera.com> and create a testnet account (1000 HBAR), or fund any EVM address at <https://portal.hedera.com/faucet> (100 HBAR/day).

```bash
cp .env.example .env            # fill OPERATOR_ACCOUNT_ID / OPERATOR_EVM_ADDRESS / OPERATOR_PRIVATE_KEY
npm install                     # workspaces: ops, web
cd contracts && forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git && forge test
```

## Day 1 run order (Hedera foundation)

All scripts are idempotent and record their outputs in `ops/deployments/testnet.json`.

```bash
cd ops
npm run whoami                    # resolves 0.0.x id for the operator, checks balance
npm run gen-desks                 # local ECDSA keys for the demo desks (appended to .env)
npm run deploy:usd                # HTS mock USD with KYC / freeze / pause / supply keys
npm run topics                    # HCS topics: RFQ events, notice commitments

# Settlement engine (funded with HBAR to pay its own scheduled executions)
cd ../contracts && source ../.env && forge script script/DeploySettlementEngine.s.sol \
  --rpc-url hedera_testnet --broadcast --private-key $OPERATOR_PRIVATE_KEY
cd ../ops && npm run record-engine -- --address <engine address>
# verification: forge verify-contract <addr> src/SettlementEngine.sol:SettlementEngine --chain-id 296 --verifier sourcify --verifier-url https://sourcify.dev/server --constructor-args $(cast abi-encode "constructor(address,address)" $OPERATOR_EVM_ADDRESS $OPERATOR_EVM_ADDRESS)
# note: send relay transactions from one account sequentially; Hedera's relay rejects overlapping nonces

cd ../ops
npm run issue                     # ATS bond-type security via the 8.0.0 factory + roles + whitelist
npm run onboard -- --name "Meridian Credit Partners" --role seller --evm $DESK_SELLER_EVM_ADDRESS --usd 0 --key $DESK_SELLER_PRIVATE_KEY
npm run onboard -- --name "Halcyon Loan Fund IV"     --role buyer  --evm $DESK_BUYER_EVM_ADDRESS  --usd 10000000 --key $DESK_BUYER_PRIVATE_KEY
npm run onboard -- --name "Northgate Insurance"      --role lender --evm $DESK_LENDER3_EVM_ADDRESS --usd 1000000 --key $DESK_LENDER3_PRIVATE_KEY
npm run onboard -- --name "Unverified account"       --role outsider --evm $DESK_OUTSIDER_EVM_ADDRESS --no-kyc --hbar 5
# (--key lets the script sign the HTS token association for the desk; a Privy wallet instead calls the token's associate() facade)
npm run eligibility -- --evm $DESK_SELLER_EVM_ADDRESS  --grant
npm run eligibility -- --evm $DESK_BUYER_EVM_ADDRESS   --grant
npm run eligibility -- --evm $DESK_LENDER3_EVM_ADDRESS --grant
npm run allocate -- --evm $DESK_SELLER_EVM_ADDRESS  --par 150000000
npm run allocate -- --evm $DESK_LENDER3_EVM_ADDRESS --par 100000000
npm run negative-test             # on-chain rejections for the unverified account
npm run raise-cap -- --max 1000000000   # upsize the tranche (CAP role + setMaxSupply) so new desks can be allocated par
npm run issue-tranche -- ...             # further ATS securities under the same credit agreement (MH-RCF, MH-DDTL were issued this way)
npm run allocate-asset -- ...            # allocate par on one of those assets
npm run settle-demo -- --delay 120                        # live atomic DvP via HSS schedule
npm run settle-demo -- --par 50000 --delay 90 --revoke-buyer   # full revert after eligibility revocation
```

## How the ATS SDK is used from a backend

The SDK ships browser and custodial wallet adapters only. `ops/src/lib/ats.ts` drives it from Node the same way the SDK's own integration tests do: the MetaMask adapter is initialised in debug mode and an ethers `Wallet` is injected as the signer. Token creation, roles, control list, issuance and reads go through the SDK facades (`Bond`, `Role`, `Security`, `Kyc`, `SsiManagement`). Internal KYC grants call the diamond's `grantKyc` directly because the SDK path requires a Terminal3 verifiable credential.

Deployed ATS infrastructure used (testnet, compatible with SDK 8.0.0): BusinessLogicResolver `0.0.9212226`, Factory `0.0.9213391`, bond configuration id 2.

## Institutional approvals with Privy (web app)

The web app in `web/` is a Next.js 16 application. Staff sign in with Privy (email or Google). A named institution is provisioned as:

- three Privy users tagged with `institution` and `role` (trader, compliance officer, portfolio manager),
- a **key quorum** of those users with threshold **2 of 3** (a self-service judge desk instead gets a quorum of its trader, the venue's automated compliance co-signer key and a reserve P-256 key minted for that desk with only its public half kept, also threshold 2),
- a **policy** owned by the quorum that only allows `eth_signTransaction` to the settlement venue contracts on Hedera testnet with zero value,
- a **desk wallet** owned by the quorum and governed by the policy.

A desk action (for example approving a settlement instruction) is an **intent** on the desk wallet. A trader or portfolio manager proposes it, and each approver authorises with their own login session: the browser signs the intent payload with the member's Privy user key (server-side token exchange is the fallback). When two members have signed, Privy executes the action and the venue broadcasts the signed transaction to Hedera. The app secret alone cannot move the wallet, and the server never holds a human desk key.

Broadcasting is deliberately conservative: each intent takes the wallet's first unreserved nonce (never highest + 1, so a rejected approval cannot leave a permanent gap), `broadcast()` looks up the receipt of the signed transaction's hash before and after sending, a relay timeout is reported as pending rather than failed, and a relay rejection for insufficient HBAR is reported as such. The market tick keeps every desk wallet above 8 HBAR (topping up 20 HBAR from the operator) because a Privy-signed transaction reserves gasLimit × maxFee, about 6 HBAR at the relay's price, before it executes.

```bash
cd web
npm run dev                                   # http://localhost:3000, uses ../.env (symlinked)
npx tsx scripts/provision.mts <id> "<name>" <trader@> <compliance@> <pm@>   # provision an institution
npx tsx scripts/intent-test.mts <id>          # create a test intent and print it
npx tsx scripts/provision-automated-desk.mts <id> "<Name>" [--demo-counterparty]   # automated institution (two server-held keys)
npx tsx scripts/hedera-onboard.mts <id> status|sync|fundUsd <amount>          # Hedera onboarding by hand; the market tick does this automatically
npx tsx scripts/market-tick.mts               # one market tick (onboarding, gas float, automated signatures, broadcasts, settlement sync)
node --import tsx --test scripts/*.test.mts   # offline tests: nonce allocation, approvals, assignments, issuance, keys, reset, register interest
```

### RFQ market and settlement between Privy desks (Day 3)

- RFQ, quote, acceptance, instruction, approval and settlement events are JSON messages on the HCS RFQ topic; the blotter is a read model folded from the topic.
- Accepting a quote creates the settlement instruction on the engine (venue key) and proposes one approval intent to each desk. When a desk's quorum executes, the venue broadcasts the signed `approve` to Hedera; the second approval schedules the atomic settlement.
- Desk wallets join Hedera from the market tick that runs after any API response (or by hand with `web/scripts/hedera-onboard.mts`): operator steps (fund 10 HBAR, eligibility, allocate US$10m par on Tranche A, mock-USD KYC and US$15m cash) and three desk-signed steps proposed together as quorum intents (mock-USD association via HIP-719, standing loan-token and cash authorisations to the engine). The Institution page shows the three phases and the three signature tiles, and a failed step offers **Recover approval** ([docs/onboarding-recovery.md](docs/onboarding-recovery.md)).

Dashboard settings that complete the B2B setup (allowlist, MFA, login methods, app clients, webhooks) are listed in [docs/privy-dashboard.md](docs/privy-dashboard.md). Provisioned institutions are recorded in `web/data/org.json`.

## Confidential interest calculation with Chainlink CRE (Day 4)

Floating-rate loans reset their interest rates, and trading changes lender positions. Servicing therefore requires both the applicable rate terms and an ownership record to determine each holder's payment. CRE connects the private rate notice to the register snapshot, calculating the distribution without publishing the underlying terms.

`cre/interest-accrual` is a CRE Confidential Workflow (TypeScript, `handlerInTee`). The agent commits a salted hash of its private rate notice to the HCS notices topic; inside the enclave the workflow fetches the notice with a Vault DON secret, verifies it against the commitment, reads every holder's balance from the ATS register in one call through `RegisterSnapshot`, and reports only the per-holder distribution. A tampered notice aborts the run. The enclave makes three HTTP requests per period regardless of holder count (topic, notice, snapshot), and reassembles HCS messages that the network chunked above 1,024 bytes. See [cre/README.md](cre/README.md).

### Interest payout (FR-12)

`npm run demo:cre` runs the confidential simulation for every asset on the register and captures each workflow's *released* output (commitment, period, holders, amounts; no rate, basis or nonce) in `cre/evidence/distributions/<SYMBOL>.json` (the first tranche also keeps the legacy `distribution.json`). `npm run demo:payout -- --facility <SYMBOL>` (`ops/src/pay-interest.ts`) checks that commitment against the HCS notices topic, checks each holder can receive mock USD, mints the period's interest to the paying agent (the borrower's payment, modelled on the test token), credits eligible holders in **atomic HTS transfers of up to nine credits each** (the network's per-transaction cap), publishes an `interest-payout` receipt on the notices topic and writes `cre/evidence/payouts/<SYMBOL>.json`. Holders it had to skip (no par at payout time, mock USD not yet associated, KYC not granted) are listed with the reason; `--catch-up` later pays only those holders and merges them into the same period's receipt, so nobody is paid twice. The Loan register and the Interest & payments page read these files. First run on testnet for period 2 (7.25%, 30 days, five-holder snapshot):

| Step | Evidence |
|---|---|
| Commitment for period 2 | [HCS #2 on 0.0.10459666](https://hashscan.io/testnet/topic/0.0.10459666), commitment `0xe1b1…338f` |
| CRE valid run | 5 holders, 30 days, total 1,510,416.67 mUSD computed; `cre/evidence/distribution.json` |
| CRE tamper run | aborted: `notice does not match the committed hash for period 2` |
| Mint to paying agent | [0.0.10457020-1789160129-193752727](https://hashscan.io/testnet/transaction/0.0.10457020-1789160129-193752727) |
| Atomic payout, 3 holders, 906,249.99 mUSD | [0.0.10457020-1789160134-460654518](https://hashscan.io/testnet/transaction/0.0.10457020-1789160134-460654518): Meridian 241,666.66, Halcyon 60,416.66, Northgate 604,166.66 |
| Payout receipt | [HCS #3 on 0.0.10459666](https://hashscan.io/testnet/topic/0.0.10459666), lists paid and skipped holders |

Second run for period 3, after 25 retail feeder holders joined the register (see "Retail feeder holders on public testnet" below): 30-holder snapshot in one enclave call, 28 holders paid in four atomic batches, commitment at [HCS #5–6](https://hashscan.io/testnet/topic/0.0.10459666) (chunked by the network above 1,024 bytes), receipt at HCS #8. Batch links: [1](https://hashscan.io/testnet/transaction/0.0.10457020-1789166208-497320803), [2](https://hashscan.io/testnet/transaction/0.0.10457020-1789166209-592044415), [3](https://hashscan.io/testnet/transaction/0.0.10457020-1789166207-312099538), [4](https://hashscan.io/testnet/transaction/0.0.10457020-1789166210-911781675). Each feeder holder received 6.04 mUSD on 1,000 par.

Two holders were skipped in both runs with the reason on the receipt: the Halcyon Privy desk wallet held no par at the time, and the Meridian Privy desk wallet's mock-USD association intent had not yet been executed by its quorum. Meridian's quorum has since executed it and Halcyon now holds par, so `npm run demo:payout -- --facility MHTLB-A --catch-up` pays Meridian at once and Halcyon as soon as its quorum signs the association on the Institution page. Since 2026-09-13 the same workflow has run for every asset on the register (`MH-RCF`, `MH-DDTL`, `MHTLB-B`, `MHTLB-C`), with per-asset distributions and payouts under `cre/evidence/`. This is the PRD's disclosed fallback (batched HTS transfers signed by the paying agent) rather than an on-chain `InterestDistributor` consuming a DON-signed report. In production the intended replacement is ATS corporate actions and Mass Payout driven by the DON-signed distribution, which keeps the payout inside the security's own lifecycle controls.

### Tranche upsizing

The original 250,000,000 units were fully issued, so self-service desks could not be allocated an opening position. The agent granted itself the ATS `CAP_ROLE` and raised the maximum supply to 1,000,000,000 units ([transaction](https://hashscan.io/testnet/transaction/0x9f0fa495b7160c41eb253ba703999a712d5a1459085888700d87c294c4e36bce)); total supply grows only when a new desk is allocated par. `npm run raise-cap` in `ops/`.

### Lifecycle controls (FR-15)

`npm run demo:controls` (`ops/src/freeze-demo.ts`) exercises the controls on both legs with real failing transactions, then restores them:

| Control | Result | Evidence |
|---|---|---|
| HTS freeze on the buyer's mock USD | transfer blocked `ACCOUNT_FROZEN_FOR_TOKEN` | [0.0.10457020-1789160141-934481668](https://hashscan.io/testnet/transaction/0.0.10457020-1789160141-934481668) |
| HTS pause on mock USD | transfer blocked `TOKEN_IS_PAUSED` | [0.0.10457020-1789160146-977861526](https://hashscan.io/testnet/transaction/0.0.10457020-1789160146-977861526) |
| Controls restored | transfer succeeds | [0.0.10457020-1789160149-779324053](https://hashscan.io/testnet/transaction/0.0.10457020-1789160149-779324053) |
| ATS pause on the loan token | seller transfer reverted | [0xcb197f…7092](https://hashscan.io/testnet/transaction/0xcb197f185623af441dda00ca2d87d0427ea8f962c128b4968a3406a7cf917092) |

## Settlement design notes

- Each desk approves a hash of the full instruction (tokens, parties, par, cash, dates, RFQ reference). Both hashes must match.
- The second approval schedules `settle(tradeId)` on the Hedera Schedule Service. The engine pays for the scheduled execution, so it holds HBAR.
- `settle` runs both legs inside an external self-call under try/catch: a revert in either leg (ATS eligibility, HTS KYC, allowance, balance, pause) rolls back both and stores the revert data in the trade as `Failed`, so operations can correct and reissue.
- The engine uses `transferFrom` on the ATS token deliberately. ATS also offers `forcedTransfer` for agents, but that path skips compliance checks, which would defeat the "revoked buyer causes a full revert" guarantee.

## Integration hooks for the agent's systems

The adoption path is a shadow register beside the agent's books, integrated with what the agent already runs rather than re-keyed. Two adapters implement that:

| Adapter | What it does | Evidence |
|---|---|---|
| `npm run agent:reconcile -- --attest` (`ops/src/reconcile-register.ts`) | Takes the agent's lender-register export as CSV (`ops/samples/agent-register-MHTLB-A.csv`, the shape a Loan IQ book or a Versana feed produces), resolves each lender to its wallet, reads the ATS balance and marks every row AGREES or BREAK with the agreement rate (the pilot's headline metric, PRD §9.2). Only a SHA-256 of the report is attested on HCS; positions stay with the agent. | Sample run: 2/4 agree, two equal-and-opposite breaks of 5,000,000 par flagged as an assignment settled on the register but not yet processed in the agent's book. Report in `ops/reports/`; hash attested at [HCS #4 on 0.0.10459666](https://hashscan.io/testnet/topic/0.0.10459666) |
| `npm run agent:export` (`ops/src/export-assignments.ts`) | Reads every trade from the engine and writes assignment records in the LSTA assignment-agreement vocabulary (assignor, assignee, assigned principal, purchase price, trade and settlement dates, settlement transaction) as CSV and JSON for the agent's loan system or a ClearPar-style workflow. | `ops/exports/assignments-MHTLB-A.csv`: trade 1 settled, trade 2 failed with the on-chain reason |

Together they close the loop the reconciliation points at: a break on the register is explained by an exported assignment the agent has not processed yet.

## Network impact

Every institution is a Hedera account, every trade is a set of HCS messages and contract executions, and every accrual period is a set of consensus transactions. Mirror-node reads (blotter, portfolio, enclave snapshot) are not counted.

| Unit | Consensus transactions | Detail |
|---|---|---|
| Onboard one institution | 1 account, ~8 transactions | alias funding, whitelist, internal KYC, mock-USD KYC, association (HIP-719), two standing allowances, cash funding |
| One secondary trade | 7 HCS messages, 4 contract executions, 1 schedule | rfq, quote, accept, instruction, two approvals, settlement receipt; `createTrade`, two `approve`, network-executed `settle` |
| One interest period | 2 HCS messages, 2 token transactions | commitment, payout receipt; mint, one batched HTS transfer to all holders |

Worked example for one agent's book of 200 facilities with 20 lenders each, 4 secondary trades per facility per year and monthly interest: up to 4,000 institutional accounts once, then about 9,600 trade transactions and 9,600 accrual transactions per year. Scaling to the roughly 1,500 facilities Versana reports keeps the same shape at about 7.5× those numbers.

| Case | Transactions per year | Average TPS | Network fees per year at public fee-schedule prices |
|---|---|---|---|
| One agent, 200 facilities | ~19,200 | ~0.0006 | on the order of US$200 |
| Versana-scale, 1,500 facilities | ~144,000 | ~0.005 | on the order of US$1,300 |

The throughput is small by design: this is institutional B2B. Fee estimates use HCS submit US$0.0001, HTS transfer US$0.001, schedule create US$0.01 and about US$0.05 per contract execution, and should be read as orders of magnitude.

### Value, not throughput

Institutional flow is measured in value per transaction and in what the on-register asset can then be used for, not in transactions per second. Same worked example, with two further labelled assumptions: an average facility of US$600m (Versana's roughly US$900bn across about 1,500 facilities) and an average trade of US$5m par (the demo trade size).

| Measure | One agent, 200 facilities | Versana-scale, 1,500 facilities |
|---|---|---|
| Loan par held on the ATS register | US$120bn | US$900bn |
| Secondary notional settled through the engine per year | US$4bn | US$30bn |
| Interest paid through HTS payouts per year (at 7.25%, the demo rate) | US$8.7bn | US$65bn |
| Value moved per settlement or payout transaction (800 settlements and 2,400 payouts; 6,000 and 18,000 at scale) | about US$4m | about US$4m |
| Payment-token balance needed on the network on a monthly interest date | about US$725m | about US$5.4bn |

Three consequences for the network:

1. **Each transaction is a large-value transfer.** One settlement moves US$5m of par against US$4.95m of cash; one payout moves a month's interest for a whole facility, about US$3.6m at the assumed size. Thousands of these a year are worth more to a ledger than millions of small transfers.
2. **The cash leg pulls institutional money onto the network.** Atomic DvP requires the purchase price and every interest payment to sit in a regulated stablecoin or tokenised deposit on the same ledger. Interest alone means hundreds of millions of dollars of payment-token balances on each monthly payment date.
3. **On-register loan positions become reusable collateral.** Today a loan interest is close to unusable as collateral because its transfer takes weeks and its title sits in an agent's spreadsheet. Once it is a transferable ATS position with atomic settlement and eligibility enforced by the token, the same position can be pledged for secured funding or as margin for OTC derivatives on the same ledger, which is Fullmetal Finance's core business. Every dollar of par on the register is a dollar of collateral that did not exist on-chain before, and the collateral pool for a HashSphere deployment is measured in the hundreds of billions before a single retail account is opened.

That is why the network's gain here is institutional accounts, institutional cash and institutional collateral with the same transaction shape on HashSphere, rather than TPS.

### Retail on public Hedera, institutions on HashSphere

The intended production topology has two layers with one transaction shape:

- **Institutional core on HashSphere.** The agent's register, the RFQ market and settlement between institutions run on a private Hedera network, because lender positions, prices and facility terms cannot be public.
- **Retail holders on public Hedera.** Feeder vehicles that pass a lender position through to many holders need public custody, public transferability and public-network accounts. Their holders live on Hedera mainnet, and the feeder is the bridge: it is one institutional lender on the HashSphere register and the issuer of many small positions on the public network.

Public-network account and transaction growth therefore comes from the retail layer, and it ships in this repository: the section below onboarded 25 feeder holders on public testnet and paid them.

### Retail feeder holders on public testnet

`npm run demo:feeder -- --holders 25 --par 1000` (`ops/src/feeder-demo.ts`) creates feeder holders as real public-network accounts and register positions, with the same controls as the institutional lenders: alias funding creates the account, mock-USD association and KYC, ATS whitelist and internal KYC, then a compliance-checked transfer of par from the feeder (Northgate Insurance acts as the pass-through vehicle). Holder keys stay local and gitignored; addresses and account ids are in `ops/deployments/testnet.json` under `feeder`.

| Measure | Result |
|---|---|
| Holders onboarded | 25 public testnet accounts, first [0.0.10486330](https://hashscan.io/testnet/account/0.0.10486330) |
| Transactions | 150 in 753 s (6 per holder: fund, associate, KYC, whitelist, ATS KYC, transfer) |
| Accrual (period 3) | 30-holder snapshot in one enclave call via `RegisterSnapshot`; 1,510,416.67 mUSD computed; tampered notice rejected |
| Payout | 28 holders in 4 atomic HTS batches (receipt HCS #8); 6.04 mUSD per feeder holder on 1,000 par at 7.25% for 30 days |
| Reconciliation | the agent's book carries the feeder as one line of 25,000 par; the register shows 25 positions; AGREES (attested HCS #7) |

So the account driver is code, not a scenario: each additional retail holder is one more public-network account, six onboarding transactions, and one payout credit per period. What follows scales that up.

### Extension to retail accounts

The same register extends to many more accounts without new mechanisms. Once a tranche is an ATS position with atomic settlement and confidential accrual, a regulated feeder (fund units or participations issued against the register, for qualified investors and, where a jurisdiction permits, retail investors) can hold a lender position and pass it through to its own holders on the same ledger:

- each feeder holder is an ATS-whitelisted, KYC-gated position, exactly as the five demo lenders are;
- the accrual workflow already computes a per-holder distribution from the register snapshot; a feeder simply makes the holder list longer, and ATS Mass Payout is the intended production path;
- the RFQ market and the engine are unchanged, because the feeder is one lender on the register.

Labelled scenario, extrapolating the feeder demo above: if one in ten facilities at Versana scale has a feeder with 5,000 holders, that is 150 feeders, 750,000 KYC-gated accounts, and 750,000 HTS interest transfers a month (9m a year, about 0.3 TPS sustained with monthly peaks). If a feeder holds a US$30m position (5% of the US$600m facility), each holder's monthly transfer is about US$36 at 7.25%; at a US$120m position it is about US$145. Account creation and throughput then grow with holders rather than with facilities, on top of the institutional collateral pool above. India is the natural first case: the same banks that expressed interest run large retail franchises, and SLMA's mandate is to widen participation in the loan market.

## Disclosure

Testnet activity is a technical demonstration with synthetic data. Tokens do not constitute legal title to a loan interest. Fallbacks adopted in the demo:

- **CRE** runs in the local simulator, not a deployed enclave (Confidential Workflows is in private beta; enrolment has been requested). The UI reads sanitised evidence files that the demo scripts write.
- **Interest payout** is a paying-agent batch of HTS transfers driven by the workflow's released output, not an on-chain distributor consuming a DON-signed report.
- **Persistence** in the web app is a JSON document store: files under `web/data/` locally, mirrored to Upstash Redis when hosted (Vercel's filesystem is ephemeral). Browser issuances and the hosted demo's workflow state live in the same store.
- **One Privy desk wallet** (Halcyon) has not executed its mock-USD association intent, so payouts skip it with the reason recorded on HCS until its quorum signs; Meridian's earlier skip is settled by a catch-up payout.
- **Gas float.** Desk wallets are topped up with testnet HBAR by the operator whenever they fall under 8 HBAR, because the relay refuses a Privy-signed transaction that cannot reserve its full gas limit. In production the desk funds its own account.
- **RFQ payloads** are plain text on the public topic (FR-16 not done).
