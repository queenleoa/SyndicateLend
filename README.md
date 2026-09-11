# SyndicateLend

[![ci](https://github.com/queenleoa/SyndicateLend/actions/workflows/ci.yml/badge.svg)](https://github.com/queenleoa/SyndicateLend/actions/workflows/ci.yml)

Private tokenised register and RFQ secondary market for syndicated-loan interests on Hedera. Built by the founder of [Fullmetal Finance](https://fullmetal.finance) (collateral and settlement-efficiency products for institutional finance) for the Hedera hackathon, ATS track.

**Read first:** [PITCH.md](PITCH.md) (problem, solution, validation, ask) · [HACKATHON-PRD.md](HACKATHON-PRD.md) (full spec, status at submission in §8.5) · [docs/validation.md](docs/validation.md) · [docs/lean-canvas.md](docs/lean-canvas.md)

- **Register:** one Asset Tokenization Studio (ATS) security per term-loan tranche (bond-type diamond, whitelist control list, internal KYC). 1 token = US$1 par.
- **Payment leg:** permissioned HTS mock-USD token (KYC, freeze, pause keys held by the administrative agent).
- **Settlement:** `SettlementEngine` exchanges loan tokens and mock USD atomically in one contract call, scheduled through the Hedera Schedule Service (HIP-1215 `scheduleCall`). Any compliance, balance or allowance failure reverts both legs and records the reason on-chain.
- **Approvals:** Privy quorum-controlled desk wallets (Day 3).
- **Interest:** agent commits a salted hash of the private rate notice to HCS; a Chainlink CRE confidential workflow verifies it in a TEE, computes accrual and releases only the distribution; the paying agent settles it in one atomic HTS transfer (Day 4).

## What is new here

Tokenised private credit (Maple, Centrifuge, Figure, tokenised CLOs) wraps *exposure* to loans in a token; the loan still settles the old way behind the wrapper. SyndicateLend tokenises the **assignment itself** on the agent's register and makes its settlement atomic and compliance-aware. Specifically:

1. **In-contract scheduling, contract as payer.** The engine calls HSS `scheduleCall` (HIP-1215) itself on the second approval and funds the scheduled execution. No keeper.
2. **Revocation triggers a full revert at execution.** Compliance can revoke a buyer after both approvals; the scheduled settlement fails as a whole with the ATS reason stored on-chain. `transferFrom`, not `forcedTransfer`, so the check cannot be bypassed.
3. **Commitment-verified confidential accrual.** Salted hash on HCS; Chainlink CRE verifies the private notice in a TEE and releases only per-holder amounts; a tampered notice aborts.
4. **User-bound institutional quorum.** Privy 2-of-3 key quorums own each desk wallet under a policy limited to the venue contracts; the app secret alone cannot move assets.
5. **The market's own workflow.** RFQ, not an order book; an agent-centred register, not a fund wrapper.
6. **Integration with the agent's book, not around it.** A register-reconciliation adapter that ingests the agent's own export and attests only a report hash on HCS, and an LSTA-vocabulary assignment export, so the shadow-register pilot needs no re-keying. See "Integration hooks" below.

The comparison table is in [HACKATHON-PRD.md §2.5](HACKATHON-PRD.md#25-why-this-is-more-than-tokenised-private-credit).

## Judging without a Privy login

The browser flow needs Privy institutions provisioned locally (`web/data/` is gitignored because it holds member emails). Every on-chain claim below is reproducible without it from the `ops/` scripts against the committed ids in `ops/deployments/testnet.json`, and every artefact links to HashScan. CI runs the 19 Foundry tests, `tsc --noEmit` for ops and web, and eslint on each push.

## Live on Hedera testnet (Day 1, 2026-09-10)

| Artefact | Id | Inspect |
|---|---|---|
| Loan tranche (ATS bond-type security, Reg S, whitelist + internal KYC) | `0.0.10459721` / `0x1600f4a4609b9e9c48c432a16732da2634b7b1b7` | [HashScan](https://hashscan.io/testnet/contract/0.0.10459721) |
| SettlementEngine (Sourcify exact match) | `0.0.10460134` / `0x593D401cF80FAE8422a5aA113075cD2F464c297F` | [HashScan](https://hashscan.io/testnet/contract/0.0.10460134) |
| Mock USD (HTS, KYC / freeze / pause keys) | `0.0.10459660` | [HashScan](https://hashscan.io/testnet/token/0.0.10459660) |
| HCS RFQ topic | `0.0.10459663` | [HashScan](https://hashscan.io/testnet/topic/0.0.10459663) |
| HCS notice-commitment topic | `0.0.10459666` | [HashScan](https://hashscan.io/testnet/topic/0.0.10459666) |
| Administrative agent | `0.0.10457020` | [HashScan](https://hashscan.io/testnet/account/0.0.10457020) |

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
| `web/` | Institutional web app (Day 3) |
| `cre/` | Chainlink CRE confidential workflow (Day 4); `cre/evidence/` holds the sanitised simulation results, released distribution and payout receipt |
| `docs/` | Validation record, Lean Canvas, Privy dashboard settings |
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
6. Open **Interest lifecycle** to show the confidential-data boundary, public HCS commitment, valid calculation and altered-notice rejection. Run `npm run demo:cre` beforehand to capture the two simulation results for this screen.

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
npm run settle-demo -- --delay 120                        # live atomic DvP via HSS schedule
npm run settle-demo -- --par 50000 --delay 90 --revoke-buyer   # full revert after eligibility revocation
```

## How the ATS SDK is used from a backend

The SDK ships browser and custodial wallet adapters only. `ops/src/lib/ats.ts` drives it from Node the same way the SDK's own integration tests do: the MetaMask adapter is initialised in debug mode and an ethers `Wallet` is injected as the signer. Token creation, roles, control list, issuance and reads go through the SDK facades (`Bond`, `Role`, `Security`, `Kyc`, `SsiManagement`). Internal KYC grants call the diamond's `grantKyc` directly because the SDK path requires a Terminal3 verifiable credential.

Deployed ATS infrastructure used (testnet, compatible with SDK 8.0.0): BusinessLogicResolver `0.0.9212226`, Factory `0.0.9213391`, bond configuration id 2.

## Institutional approvals with Privy (web app)

The web app in `web/` is a Next.js 16 application. Staff sign in with Privy (email or Google). Each institution is provisioned as:

- three Privy users tagged with `institution` and `role` (trader, compliance officer, portfolio manager),
- a **key quorum** of those users with threshold **2 of 3**,
- a **policy** owned by the quorum that only allows `eth_signTransaction` to the settlement venue contracts on Hedera testnet with zero value,
- a **desk wallet** owned by the quorum and governed by the policy.

A desk action (for example approving a settlement instruction) is an **intent** on the desk wallet. A trader or portfolio manager proposes it, and each approver authorises with their own login session: the server exchanges the member's access token for a short-lived user signing key and posts the signature to the intent. When two members have signed, Privy executes the action. The app secret alone cannot move the wallet, and the server never holds a desk key.

```bash
cd web
npm run dev                                   # http://localhost:3000, uses ../.env (symlinked)
npx tsx scripts/provision.mts <id> "<name>" <trader@> <compliance@> <pm@>   # provision an institution
npx tsx scripts/intent-test.mts <id>          # create a test intent and print it
```

### RFQ market and settlement between Privy desks (Day 3)

- RFQ, quote, acceptance, instruction, approval and settlement events are JSON messages on the HCS RFQ topic; the blotter is a read model folded from the topic.
- Accepting a quote creates the settlement instruction on the engine (venue key) and proposes one approval intent to each desk. When a desk's quorum executes, the venue broadcasts the signed `approve` to Hedera; the second approval schedules the atomic settlement.
- Desk wallets join Hedera through `web/scripts/hedera-onboard.mts` (or the admin page): operator steps (fund, eligibility, allocate, mock-USD KYC and cash) and desk-signed steps as quorum intents (mock-USD association via HIP-719, standing authorisations to the engine).

Dashboard settings that complete the B2B setup (allowlist, MFA, login methods, app clients, webhooks) are listed in [docs/privy-dashboard.md](docs/privy-dashboard.md). Provisioned institutions are recorded in `web/data/org.json`.

## Confidential interest calculation with Chainlink CRE (Day 4)

`cre/interest-accrual` is a CRE Confidential Workflow (TypeScript, `handlerInTee`). The agent commits a salted hash of its private rate notice to the HCS notices topic; inside the enclave the workflow fetches the notice with a Vault DON secret, verifies it against the commitment, reads holder balances from the ATS register, and reports only the per-holder distribution. A tampered notice aborts the run. See [cre/README.md](cre/README.md).

### Interest payout (FR-12)

`npm run demo:cre` now also captures the workflow's *released* output (commitment, period, holders, amounts; no rate, basis or nonce) in `cre/evidence/distribution.json`. `npm run demo:payout` (`ops/src/pay-interest.ts`) checks that commitment against the HCS notices topic, checks each holder can receive mock USD, mints the period's interest to the paying agent (the borrower's payment, modelled on the test token), credits every eligible holder in **one atomic HTS transfer**, and publishes an `interest-payout` receipt on the notices topic. Run on testnet for period 2 (7.25%, 30 days, five-holder snapshot):

| Step | Evidence |
|---|---|
| Commitment for period 2 | [HCS #2 on 0.0.10459666](https://hashscan.io/testnet/topic/0.0.10459666), commitment `0xe1b1…338f` |
| CRE valid run | 5 holders, 30 days, total 1,510,416.67 mUSD computed; `cre/evidence/distribution.json` |
| CRE tamper run | aborted: `notice does not match the committed hash for period 2` |
| Mint to paying agent | [0.0.10457020-1789160129-193752727](https://hashscan.io/testnet/transaction/0.0.10457020-1789160129-193752727) |
| Atomic payout, 3 holders, 906,249.99 mUSD | [0.0.10457020-1789160134-460654518](https://hashscan.io/testnet/transaction/0.0.10457020-1789160134-460654518): Meridian 241,666.66, Halcyon 60,416.66, Northgate 604,166.66 |
| Payout receipt | [HCS #3 on 0.0.10459666](https://hashscan.io/testnet/topic/0.0.10459666), lists paid and skipped holders |

Two holders were skipped with the reason on the receipt: the Halcyon Privy desk wallet holds no par, and the Meridian Privy desk wallet's mock-USD association intent has not been executed by its quorum yet. This is the PRD's disclosed fallback (batched HTS transfers signed by the paying agent) rather than an on-chain `InterestDistributor` consuming a DON-signed report. In production the intended replacement is ATS corporate actions and Mass Payout driven by the DON-signed distribution, which keeps the payout inside the security's own lifecycle controls.

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

### Extension to retail accounts

The same register extends to many more accounts without new mechanisms. Once a tranche is an ATS position with atomic settlement and confidential accrual, a regulated feeder (fund units or participations issued against the register, for qualified investors and, where a jurisdiction permits, retail investors) can hold a lender position and pass it through to its own holders on the same ledger:

- each feeder holder is an ATS-whitelisted, KYC-gated position, exactly as the five demo lenders are;
- the accrual workflow already computes a per-holder distribution from the register snapshot; a feeder simply makes the holder list longer, and ATS Mass Payout is the intended production path;
- the RFQ market and the engine are unchanged, because the feeder is one lender on the register.

Labelled scenario, not part of the build: if one in ten facilities at Versana scale has a feeder with 5,000 holders, that is 150 feeders, 750,000 KYC-gated accounts, and 750,000 HTS interest transfers a month (9m a year, about 0.3 TPS sustained with monthly peaks). If a feeder holds a US$30m position (5% of the US$600m facility), each holder's monthly transfer is about US$36 at 7.25%; at a US$120m position it is about US$145. Account creation and throughput then grow with holders rather than with facilities, on top of the institutional collateral pool above. India is the natural first case: the same banks that expressed interest run large retail franchises, and SLMA's mandate is to widen participation in the loan market.

## Disclosure

Testnet activity is a technical demonstration with synthetic data. Tokens do not constitute legal title to a loan interest. Fallbacks adopted in the demo:

- **CRE** runs in the local simulator, not a deployed enclave (Confidential Workflows is in private beta). The UI reads sanitised evidence files that the demo scripts write.
- **Interest payout** is a paying-agent batch of HTS transfers driven by the workflow's released output, not an on-chain distributor consuming a DON-signed report.
- **Persistence** in the web app is a JSON file store.
- **Two Privy desk wallets** in the period-2 snapshot have not executed their mock-USD association intent, so they were skipped by the payout with the reason recorded on HCS.
- **RFQ payloads** are plain text on the public topic (FR-16 not done).
