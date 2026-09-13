# Recovering wallet setup

The Institution page shows wallet setup as three phases (network setup by the agent bank, the desk's three signatures, funding). The three signature tiles are **Enable payment-token receipts** (the HIP-719 mock-USD association), **Authorise loan-token settlement** and **Authorise cash settlement** (standing allowances to the settlement engine). None of them issues a loan, moves the payment balance or creates a wallet.

If setup reports `WRONG_NONCE`:

1. Restart the local Next server after applying the fix (or deploy the updated app). This clears receipt watchers left running by the old code.
2. Open **Institution → Check approved transactions** to reconcile the recorded approval.
3. At the failed step, choose **Recover setup approval**. The server checks the original receipt and searches for an existing approval with the exact same wallet, network, token, spender and allowance.
4. If a matching approval already settled, setup is marked complete without another transaction. If it is still valid, its own signatures are preserved. Obsolete pending duplicates of that same permission are withdrawn; unrelated approvals are untouched. On the Institution page the failed tile shows **Recover approval**.
5. Only a confirmed failure, rejected intent or expired unsigned intent permits a fresh request. A new transaction must obtain fresh quorum approvals. Use **Check approved transactions** after approval if execution has not yet appeared.

Recovery is scoped to the signed-in institution and the exact reviewed setup intent. It never funds accounts, mints tokens or automatically signs for a member. Unknown receipts and provisional relay timeouts are not treated as completed or failed transactions.

## Root cause and regression check

The reported Meridian transaction used nonce 4 when the wallet expected 3. An earlier matching nonce-3 approval had been orphaned from the setup record; retries continued creating higher-nonce intents. The updated allocator fills the first unreserved nonce, reads every page of the wallet's intents and fails closed if it cannot read reservations. Setup advances one transaction at a time.

The second fault was receipt watching: ethers' background transaction subscriber could emit an unhandled rejection when the relay returned a structured rejection instead of a receipt. The updated broadcast path explicitly awaits bounded receipt reads and checks Mirror-node results. Hedera documents these [`-32003` receipt responses and provisional timeouts](https://github.com/hiero-ledger/hiero-json-rpc-relay/blob/main/docs/debugging-transactions.md#receipt-fallback).

Offline regression tests:

```sh
cd web
node --import tsx --test scripts/onboarding-nonce.test.mts
```

## "Wallet transaction nonce N does not match Hedera's next nonce N-1"

This is a `NONCE_GAP`: the wallet already has an earlier executed transaction that has not landed on Hedera, so the relay will not accept the later one yet. Nothing needs replacing. The usual cause on testnet is gas: a Privy-signed transaction must reserve its full gas limit at the relay's price (about 6 HBAR for a 2.5m-gas approval) before it executes, and a desk wallet that has dropped under that is refused with `Insufficient funds for transfer`. The app now reports that as "too little HBAR to reserve gas" instead of "pending", and the market tick tops the wallet up with 20 HBAR from the operator whenever it falls under 8 HBAR, then re-broadcasts the earlier transaction on the next tick; the later one follows once the nonce matches. **Check approved transactions** (Institution) or any page load triggers the tick.
