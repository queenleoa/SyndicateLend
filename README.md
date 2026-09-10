# SyndicateLend

Private tokenised register and RFQ secondary market for syndicated-loan interests on Hedera.

- **Register:** one Asset Tokenization Studio (ATS) security per term-loan tranche (bond-type diamond, whitelist control list, internal KYC). 1 token = US$1 par.
- **Payment leg:** permissioned HTS mock-USD token (KYC, freeze, pause keys held by the administrative agent).
- **Settlement:** `SettlementEngine` exchanges loan tokens and mock USD atomically in one contract call, scheduled through the Hedera Schedule Service (HIP-1215 `scheduleCall`). Any compliance, balance or allowance failure reverts both legs and records the reason on-chain.
- **Approvals:** Privy quorum-controlled desk wallets (Day 3).
- **Interest:** agent commits a salted hash of the private rate notice to HCS; a Chainlink CRE confidential workflow verifies it in a TEE and computes accrual (Day 4).

Full product spec: [HACKATHON-PRD.md](HACKATHON-PRD.md).

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
# then put the address in ops/deployments/testnet.json under settlementEngine.address

cd ../ops
npm run issue                     # ATS bond-type security via the 8.0.0 factory + roles + whitelist
npm run onboard -- --name "Meridian Credit Partners" --role seller --evm $DESK_SELLER_EVM_ADDRESS --usd 0
npm run onboard -- --name "Halcyon Loan Fund IV"     --role buyer  --evm $DESK_BUYER_EVM_ADDRESS  --usd 10000000
npm run onboard -- --name "Northgate Insurance"      --role lender --evm $DESK_LENDER3_EVM_ADDRESS --usd 1000000
npm run onboard -- --name "Unverified account"       --role outsider --evm $DESK_OUTSIDER_EVM_ADDRESS --no-kyc
npm run eligibility -- --evm $DESK_SELLER_EVM_ADDRESS  --grant
npm run eligibility -- --evm $DESK_BUYER_EVM_ADDRESS   --grant
npm run eligibility -- --evm $DESK_LENDER3_EVM_ADDRESS --grant
npm run allocate -- --evm $DESK_SELLER_EVM_ADDRESS  --par 150000000
npm run allocate -- --evm $DESK_LENDER3_EVM_ADDRESS --par 100000000
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
