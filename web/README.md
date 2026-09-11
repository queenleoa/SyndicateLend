# SyndicateLend web app

Next.js 16 institutional front end: RFQ blotter, execution room, approvals inbox, portfolio, register, interest lifecycle and an admin page. Staff sign in with Privy; every desk action is an intent on a quorum-owned desk wallet (2 of 3 members must sign).

See the [root README](../README.md) for the product overview, live testnet ids and the five-minute demo flow, and [docs/privy-dashboard.md](../docs/privy-dashboard.md) for the Privy dashboard settings.

## Run

```bash
npm install            # from the repository root (workspaces)
cd web
npm run dev            # http://localhost:3000, reads ../.env
npx tsc --noEmit && npm run lint
```

Required environment (root `.env`): `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID`, `OPERATOR_ACCOUNT_ID`, `OPERATOR_PRIVATE_KEY`, `NOTICE_API_TOKEN`. Institutions are provisioned into `web/data/org.json` (gitignored, it holds member emails and Privy ids):

```bash
npx tsx scripts/provision.mts <id> "<name>" <trader@> <compliance@> <pm@>
npx tsx scripts/hedera-onboard.mts <id> fund|eligibility|allocate|propose|sync|fundUsd|status
npx tsx scripts/publish-notice.mts 725 30         # agent: commit a private rate notice to HCS
npm run demo:counterparty -- --institution halcyon --price 99.00
```

## Layout

| Path | Contents |
|---|---|
| `src/app/(desk)/*` | Overview (execution room), blotter, approvals, portfolio, register, lifecycle, admin |
| `src/app/api/*` | RFQs, trades, approvals, portfolio, register, lifecycle, agent notice endpoint, Privy webhooks |
| `src/lib/hcs.ts` | HCS RFQ topic: publish and read model |
| `src/lib/engine.ts`, `desk-tx.ts`, `venue.ts` | SettlementEngine instructions and Privy-signed desk transactions |
| `src/lib/notices.ts` | Private rate notices and their salted HCS commitments |
| `src/lib/onboarding.ts` | Operator and desk-signed Hedera onboarding of a Privy wallet (HIP-719 association) |
| `src/lib/store.ts` | JSON file persistence for the demo (a database in production) |

Persistence is a JSON file store under `web/data/`. It is deliberately simple for a five-day build and is not a production design.
