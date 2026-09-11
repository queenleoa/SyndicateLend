# SyndicateLend contracts

Foundry project for `SettlementEngine`, the atomic delivery-versus-payment contract for tokenised loan interests.

- `src/SettlementEngine.sol`: trade instructions, hash-bound approvals from both desks, HSS scheduling from inside the contract (HIP-1215 `scheduleCall`, the engine pays), `settle` running both legs in an external self-call so any revert rolls back both and is stored on the trade, reissue and cancel paths, reentrancy guard.
- `src/interfaces/IHederaScheduleService.sol`: the Hedera Schedule Service system-contract interface.
- `src/RegisterSnapshot.sol`: one-call balance snapshot of a holder list, so the CRE enclave reads the whole register through a single mirror-node `contracts/call`. Deployed at `0x33687eBC6C3f8A89DbE60ADc3E631149dA6E0690`.
- `test/RegisterSnapshot.t.sol`: 200-holder snapshot in one call, and the empty case.
- `test/SettlementEngine.t.sol` with `test/mocks/`: ATS, HTS and HSS doubles. 19 tests cover the happy path, approval binding, eligibility revocation, cash-leg rollback, pause, expiry, replay, reissue and cancel.
- `script/DeploySettlementEngine.s.sol`: deployment (funds the engine with HBAR for its scheduled executions).

```bash
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git   # lib/ is not committed
forge test -vv
```

Deployed on Hedera testnet at `0.0.10460134` / `0x593D401cF80FAE8422a5aA113075cD2F464c297F` (Sourcify exact match). Deployment and verification commands are in the [root README](../README.md).

Design note: the engine moves the loan token with `transferFrom`, not ATS `forcedTransfer`, because the forced path skips compliance and would defeat the guarantee that a buyer revoked before execution causes a full revert.
