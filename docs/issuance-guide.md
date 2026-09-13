# Browser loan issuance

Open **Loan Registry → Issue an asset** (`/issue`). No terminal or wallet extension is required for judges.

The wizard turns ATS configuration into a short demonstration:

1. **Loan terms:** name the asset, pick its facility type (Term Loan B, Revolving Credit Facility, Delayed Draw Term Loan, Incremental Term Loan), set principal, maturity, the all-in rate in basis points and the synthetic agreement reference. One token represents $1 of principal. The rate never goes on-chain: it is the private input to the committed rate notice.
2. **Syndicate:** allocate par to the lenders on the register (a suggested split is filled in). Each lender is allowlisted, KYC-checked and issued its par directly; the agent bank keeps any remainder.
3. **Lender controls:** mandatory allowlisting and time-bound internal KYC, plus the agent's pause, freeze and controller permissions.
4. **Review & issue:** confirm the testnet transactions.
5. **On-chain register:** watch every step confirm with its receipt. Completion requires a live check that total supply equals the principal and the agent bank holds exactly the unallocated remainder. The asset then appears at the top of the loan register, tagged "Just issued by you" for six hours, with its issuing user recorded; the CRE simulation and payout scripts pick it up by symbol like any other asset.

Suggested narration: "The agent defines the asset and who can hold it. Hedera ATS creates a permissioned loan security. We allowlist and KYC each lender and issue its par, commit the rate notice as a salted hash, and every step has an on-chain receipt."

## Host configuration

Set server environment variables in the deployment dashboard; do not put secrets in `NEXT_PUBLIC_*` variables:

| Variable | Purpose |
| --- | --- |
| `ISSUANCE_DEMO_ENABLED=true` | Enable funded testnet writes. Enabled by default; set to `false` as a host kill switch. |
| `ISSUANCE_DEMO_ALLOW_JUDGES=true` | Permit any authenticated Privy user to run an issuance. Enabled by default; set to `false` to restrict issuance to `PLATFORM_ADMIN_PRIVY_USER_IDS`. |
| `ISSUANCE_DEMO_LIMIT=20` | Lifetime limit per storage namespace, including pending/failed attempts. Allowed values 1–50. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Optional distributed storage for multi-instance hosts. A single instance uses the built-in file database under `DATA_DIR`. |
| `OPERATOR_PRIVATE_KEY` | Host's ECDSA agent signer; keep funded with testnet HBAR. |
| `HEDERA_NETWORK=testnet` | Mainnet is refused; the RPC must report chain ID 296. |

The default factory is `0.0.9213391`, resolver `0.0.9212226`, ATS bond configuration version 1, matching the project's installed ATS 8.0.0 implementation. Numeric IDs are resolved through the Mirror node to their canonical EVM aliases.

One issuance runs at a time; a user can issue again once their previous issuance completed. The browser advances one bounded chain step at a time (one POST per step, signed bytes recorded before broadcast, identical bytes rebroadcast on retry). Returning to the page shows the saved state; **Resume issuance** continues it. A failed or unresolved transaction needs host review, never a second mint. The market tick and the automated institutions pause while an issuance holds the operator's signing account.

## What is actually created

The server calls the installed ATS factory contract's `deployBond` with the same configuration as the ops scripts, then `addIssuer`, `addToControlList` and `grantKyc` for the agent bank, `addToControlList` for the settlement engine, and per lender `addToControlList`, `grantKyc` and `issueByPartition`. The rate notice commitment is a `notice-commitment` message on the HCS notices topic, exactly the message the CRE confidential workflow verifies. Synthetic Reg S configuration is metadata, not a claim of legal offering compliance.

New assets are stored in the durable issuance registry and listed by the loan register beside the assets issued by the ops scripts (`ops/deployments/testnet.json`). They are register-only: the RFQ secondary market and the settlement engine policies are wired to the first tranche.
