# SyndicateLend

Private tokenised register and RFQ secondary market for syndicated-loan interests on Hedera.

- **Register:** one Asset Tokenization Studio (ATS) security per term-loan tranche (bond-type diamond, whitelist control list, internal KYC). 1 token = US$1 par.
- **Payment leg:** permissioned HTS mock-USD token (KYC, freeze, pause keys held by the administrative agent).
- **Settlement:** `SettlementEngine` exchanges loan tokens and mock USD atomically in one contract call, scheduled through the Hedera Schedule Service (HIP-1215 `scheduleCall`). Any compliance, balance or allowance failure reverts both legs and records the reason on-chain.
- **Approvals:** Privy quorum-controlled desk wallets (Day 3).
- **Interest:** agent commits a salted hash of the private rate notice to HCS; a Chainlink CRE confidential workflow verifies it in a TEE and computes accrual (Day 4).

Full product spec: [HACKATHON-PRD.md](HACKATHON-PRD.md).

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
| `web/` | Institutional web app (Day 3) |
| `cre/` | Chainlink CRE confidential workflow (Day 4) |

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

## Settlement design notes

- Each desk approves a hash of the full instruction (tokens, parties, par, cash, dates, RFQ reference). Both hashes must match.
- The second approval schedules `settle(tradeId)` on the Hedera Schedule Service. The engine pays for the scheduled execution, so it holds HBAR.
- `settle` runs both legs inside an external self-call under try/catch: a revert in either leg (ATS eligibility, HTS KYC, allowance, balance, pause) rolls back both and stores the revert data in the trade as `Failed`, so operations can correct and reissue.
- The engine uses `transferFrom` on the ATS token deliberately. ATS also offers `forcedTransfer` for agents, but that path skips compliance checks, which would defeat the "revoked buyer causes a full revert" guarantee.

## Disclosure

Testnet activity is a technical demonstration with synthetic data. Tokens do not constitute legal title to a loan interest. Fallbacks used in the demo are listed here as they are adopted.
