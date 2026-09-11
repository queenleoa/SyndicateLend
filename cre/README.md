# Confidential interest accrual

`interest-accrual` is SyndicateLend's Chainlink CRE Confidential Workflow. It registers its cron callback with `handlerInTee` and constrains execution to AWS Nitro in `us-west-2`.

## What the workflow proves

1. The administrative agent publishes a salted commitment to the private rate notice on the Hedera Consensus Service.
2. The TEE obtains `API_TOKEN` from the Vault DON and fetches the notice from the authenticated agent endpoint.
3. Inside the enclave, it recomputes the commitment, reads every holder's balance in one call through the `RegisterSnapshot` contract (`snapshotReader` in the config) and calculates interest with integer arithmetic. Three HTTP requests per period regardless of holder count; HCS messages chunked above 1,024 bytes are reassembled.
4. Only `(commitment, periodId, holders, amounts)` crosses back to the DON for a signed report. The rate, day-count basis, nonce and authenticated response do not.
5. The `tamper-settings` target requests an altered rate and must abort on the commitment mismatch.

The workflow code is not confidential. Confidential Workflows protects the data processed by that code. The simulator is also not a real TEE; live deployment requires Chainlink Confidential Workflows private-beta enrollment.

## Demo

Prerequisites: run the web service, publish at least one notice commitment, install the CRE CLI, and configure matching `NOTICE_API_TOKEN` (web service) / `SECRET_API_TOKEN` (CRE simulator) values in ignored environment files.

```bash
# terminal 1
cd web
npm run dev

# terminal 2: publish a 30-day synthetic notice at 7.25%
npx tsx scripts/publish-notice.mts 725 30

# repository root: run both the valid and tamper paths, then capture sanitized UI evidence
npm run demo:cre
```

The last command always supplies `--target`, `--non-interactive`, and `--trigger-index 0`. It records success only when the valid run completes and the tampered run fails for the expected commitment-mismatch reason. The UI reads only the sanitized result in `cre/evidence/latest.json`; it never reads the private notice or secret.

Direct commands, if you do not want evidence capture:

```bash
cd cre
cre workflow simulate interest-accrual --target staging-settings --non-interactive --trigger-index 0
cre workflow simulate interest-accrual --target tamper-settings --non-interactive --trigger-index 0
```

## Files

- `interest-accrual/workflow.ts` — confidential handler, commitment verification, ATS snapshot and accrual.
- `interest-accrual/config.staging.json` — valid-notice simulation.
- `interest-accrual/config.tamper.json` — changed-notice rejection.
- `secrets.yaml` — maps the workflow-facing secret ID; contains no secret value.
- `scripts/run-demo.mjs` — positive/negative runner and sanitized evidence capture.
