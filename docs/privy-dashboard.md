# Privy dashboard checklist for SyndicateLend

App id `cmtu0trtb00w30ci6cis79r30`. Everything below is configured at <https://dashboard.privy.io>. Items marked **API** are done by the app's provisioning code; items marked **Dashboard** must be set by hand.

## What the app already does through the API

| Object | Created by | Notes |
|---|---|---|
| One Privy user per desk member (email login), tagged with `custom_metadata { institution, role }` | `web/src/lib/provision.ts` | roles: trader, compliance, pm |
| Key quorum per named institution: the three users, threshold 2 | provision | any two of three authorise |
| Key quorum per self-service judge desk: the trader, the venue's automated compliance co-signer (first `AUTOMATED_DESK_KEYS` key) and a reserve P-256 key minted for that desk (public half only), threshold 2 | `provisionSelfServiceInstitution` | the judge signs once, the venue co-signs; the venue holds one key of three so it can never execute alone |
| Key quorum per automated institution (Aldgate, Bishopsgate): two server-held keys, threshold 2 | `provision-automated-desk.mts` | labelled as automated in the app |
| Policy per institution, owned by the quorum: `eth_signTransaction` allowed only on Hedera testnet (chain 296), zero value, and only for `approve / cancel / reissue` on the SettlementEngine or `approve(settlementEngine, …)` on the loan token and mock USD; private-key export denied; everything else denied by default | provision | changing the policy is itself a quorum action |
| Desk wallet per institution, owned by the quorum, governed by the policy | provision | no single person can sign |
| Desk actions as intents (`eth_signTransaction`) on the desk wallet; approvals signed in the browser with each member's Privy user key | `web/src/lib/approvals.ts`, `web/src/lib/desk-tx.ts` | 72-hour expiry by default; nonces reserved from the wallet's live intents |

Provisioned so far: `web/data/org.json`.

## Dashboard: required for the B2B flow

1. **Login methods** (Authentication > Login methods): keep **Email** on and enable **Google**. Under email options, allow the `+` character in addresses so plus-addressed inboxes can be used for multi-member testing. Turn off wallet login and every other social provider: staff sign in with a firm identity, not a crypto wallet.
2. **Access control** (Users > Access control): for a pilot, enable the **allowlist** and add the desk members' emails (or your company domain) so unknown emails cannot even create an account. For the hosted judge demo keep the allowlist **off**: any email must be able to sign in and get its own institution.
3. **MFA** (Authentication > Multi-factor): enable passkey and authenticator-app MFA and require it on login. Approvals are P-256 signatures bound to the member's session, so the session must be strong.
4. **Allowed origins** (Configuration > App settings > Domains): add `http://localhost:3000` (include the port) and the deployed `https://` domain. If you deploy, create a separate **app client** (Configuration > App settings > Clients) for production with its own origin and a shorter session duration, and pass its `clientId` to the provider.
5. **Branding** (UI components > Branding): upload a 2:1 PNG (180x90) version of the logo (the full wordmark is 5.7:1 and will be cropped), accent colour `#16305A`, light theme. The React config also passes these, but the hosted OAuth screens use the dashboard values.
6. **Approvals view** (Approvals page): the built-in reviewer console lists every intent the app creates with its quorum progress. Dashboard-native manual approvals are an Enterprise feature, so treat this as read-only visibility for the demo; approvals happen in the app inbox.
7. **Webhooks** (Configuration > Webhooks): register `https://<your-domain>/api/webhooks/privy` for `intent.created`, `intent.authorized`, `intent.executed`, `intent.failed`, `intent.rejected`, and copy the signing secret into `PRIVY_WEBHOOK_SECRET`. Free in development, Enterprise in production. Optional for the demo (the inbox polls every 8 seconds).
8. **IP allowlist** (Configuration > App settings > IP allowlist): once the app runs from a fixed host, restrict app-secret calls to that address.

## Dashboard: recommended, not required

- **Teammate roles** (Settings > Team): add a second dashboard user with viewer rights so a judge or colleague can see intents without being able to change the app.
- **Session duration**: set to a working day (8 to 10 hours) on the web client.
- **Custom email sender**: Privy sends OTP codes from its own domain by default; a custom sender domain looks more institutional.
- **Enterprise SSO**: if a pilot institution uses Okta or Azure AD, use JWT-based custom auth (Authentication > Custom auth) and create users with `custom_auth` linked accounts instead of email.

## Things that are deliberately not used

- Personal embedded wallets for staff (`createOnLogin: off`): staff act only through the institution's quorum wallet.
- Server-held keys as the only quorum members of a human desk: a named institution's quorum is made of Privy users, so approvals are tied to people and their MFA. A judge desk carries one venue key (the co-signer) and one reserve key beside the trader, and the two automated institutions are two-key quorums, but in every case the app secret alone can never move funds.
- `forcedTransfer`-style overrides on the Hedera side are also excluded, so the on-chain compliance checks still apply to whatever the desk wallet signs.
