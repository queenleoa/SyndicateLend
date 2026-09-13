# Demo runbook: the 2 minute 40 second video

One story: **a US$5m loan trade that normally sits exposed for three weeks settles as one transaction, with the controls a bank actually needs, and the interest gets paid to everyone on the register, including retail holders.**

## What the web app is: three workspaces, three stories

The header has four tabs; the sidebar shows the pages of the active one.

| Workspace | Whose story | Pages |
|---|---|---|
| **Institution** | *My institution's Privy wallet, its 2-of-3 approval policy and team, and the one-time wallet setup.* | Wallet & onboarding: setup shown as three phases (network setup by the agent bank, the desk's three signatures, funding) with one tile per signature |
| **Loan registry** | *I am the agent bank. I issue the assets under the credit agreement, keep the register of every lender's par, consent to transfers, and run the interest calculation.* | Issue an asset, Loan register (credit agreement → assets → lenders, live from ATS), Transfer requests, Interest & payments, Administration |
| **Secondary exchange** | *My desk trades loan interests with other institutions. The arranger consents, both desks approve, Hedera settles both legs at once.* | Execution room, RFQ trading, Desk approvals (your own desk's 2-of-3 signatures, one compact card per instruction) |
| **Positions** | *What my institution holds, has traded, and has accrued.* | Par by asset, cash, standing authorisations, my trades, my interest per asset and period |

The trade lifecycle has an explicit agent-bank step: quote accepted → **agent consent** → instruction on-chain → desk approvals (2 of 3 on each side, or the automated quorum) → scheduled → settled. A platform administrator consents from Transfer requests; otherwise the arranger automation consents after `AGENT_CONSENT_DELAY_S` (default 45 s). Two automated institutions exist: Aldgate (market maker) and Bishopsgate (counterparty for the transfer-request demo).

## The agent-bank registry demo (four steps, no terminal)

1. **Issue an asset** (`/issue`): terms, syndicate split, controls, confirm. About 15 Hedera transactions with receipts, then the HCS rate-notice commitment.
2. **Loan register** (`/register`): the new asset at the top, tagged "Just issued by you", beside the pre-issued MHTLB-A, MH-RCF and MH-DDTL and any tranche issued earlier from the wizard (MHTLB-B and MHTLB-C at the time of writing). Select an asset for its lender register and interest. The agent bank is the platform's operator account; your institution is a syndicate lender on whatever it holds (US$10m of Tranche A from onboarding, plus anything you allocated to it in the wizard).
3. **Transfer requests** (`/assignments`): **Create a demo transfer request**, review it, **Approve transfer request**. Both automated institutions sign; the network settles about four minutes after the quote; the register updates.
4. **Interest & payments** (`/lifecycle`): the released distribution and payout first (computed, paid, outstanding, receipts, one row per holder), then the pipeline and evidence. `npm run demo:cre` recomputes every asset in the confidential simulation, `npm run demo:payout -- --facility SYMBOL` pays a period, and `--catch-up` pays holders that an earlier payout skipped (a desk that had not signed its mock-USD association yet), merging them into the same receipt.

## Preparation (do once, before recording)

Meridian's desk wallet has completed setup (association, both standing authorisations, cash). Halcyon's has not: its mock-USD association intent is still pending with no signatures, so it cannot hold cash or be paid interest.

1. **Sign Halcyon's pending setup steps.** Open **Institution** in two browser profiles (Halcyon trader and Halcyon compliance, or trader and PM) and sign the permission tiles ("Enable payment-token receipts", then the two standing authorisations). Each needs two signatures; the market tick broadcasts each executed step on the next page load and then grants mock-USD KYC and funds US$15m by itself (`npx tsx scripts/hedera-onboard.mts halcyon sync` from `web/` does the same by hand).
2. **Pay the skipped interest** once the association is on-chain: `npm run demo:payout -- --facility MHTLB-A --catch-up` from the repository root.
3. **Check both desks** with `npx tsx scripts/hedera-onboard.mts <institution> status`: par, mock USD and both allowances.
4. **Refresh the interest evidence** so the Interest page is current: with `web` running, `npm run demo:cre` then `npm run demo:payout` from the repository root (period 3 is already captured; skip if unchanged).
5. **Start the two processes** for the recording: `cd web && npm run dev`, and `npm run demo:counterparty -- --institution halcyon --price 99.00` from the root.
6. **Open three browser profiles**: Meridian trader, Meridian compliance officer, Halcyon trader (plus Halcyon compliance for the buyer's second signature). Sign each in before you hit record.
7. **Set the quote to settle in 3 minutes** (`--settle-minutes 3` on the counterparty agent) so the scheduled settlement lands inside the video.

## Shot list (2:40)

| Time | On screen | Narration |
|---|---|---|
| 0:00 | Homepage | "Syndicated loans are a one-and-a-half-trillion-dollar market where a trade that takes minutes to agree takes about three weeks to settle. Ownership, eligibility, documents and cash live in four different places. SyndicateLend puts them in one." |
| 0:15 | Meridian trader: Lender register | "The loan is an Asset Tokenization Studio security on Hedera. Only whitelisted, KYC-checked institutions can hold it. This transfer to an unverified account reverted on-chain." (click the HashScan receipt) |
| 0:30 | Blotter: publish a US$5m sell RFQ | "Meridian wants to sell five million of par. The RFQ is a consensus-timestamped message on a Hedera topic." Halcyon's quote appears within seconds from the counterparty terminal. |
| 0:45 | Accept the quote | "Accepting creates the settlement instruction on the engine: parties, par, price, cash, settlement time. Both desks are now asked to approve exactly this hash." |
| 0:55 | Loan registry → Assignments | "Switch hats: as the arranger I keep the register and consent to this transfer. One click, and the settlement instruction goes on-chain." (or let the automation consent while you talk) |
| 1:05 | Approvals, Meridian trader signs | "A trader cannot commit the desk alone. Privy holds the desk wallet under a 2-of-3 quorum of named staff. One signature: nothing happens." |
| 1:15 | Approvals, Meridian compliance signs | "The compliance officer signs in her own session. Two of three: Privy signs, the venue broadcasts, the approval is on Hedera." Repeat for Halcyon trader and compliance in the other profiles (speed up). |
| 1:35 | Execution room: stage 3 Scheduled | "The second approval scheduled the settlement on the Hedera Schedule Service, from inside the contract, with the contract paying. No keeper, no operator." |
| 1:45 | Wait for execution; Portfolio / Register | "At the settlement time the network executes it: five million par to Halcyon, four point nine five million of cash to Meridian, in one transaction. If the buyer had been revoked in between, both legs revert. That happened on trade 2." (show the failed trade's HashScan reason) |
| 2:05 | Interest page | "Interest is where the private terms live. The agent commits a salted hash of the rate notice; a Chainlink CRE confidential workflow verifies it in a TEE and releases only who gets paid what. A tampered notice is rejected. This period paid twenty-eight holders, twenty-five of them retail feeder accounts, in four atomic transfers." |
| 2:25 | Blotter or README: reconciliation and export | "And it fits the agent's existing systems: the register reconciles against the agent's own export, with a hash attested on Hedera, and every settled trade exports as an LSTA-style assignment." |
| 2:35 | Homepage | "Institutions on HashSphere, retail on public Hedera, one transaction shape. SyndicateLend." |

## Judges trying it themselves (hosted demo, fully self-service)

Any email works (keep the Privy dashboard **allowlist off**, and keep "+" allowed in email addresses). Nobody has to admit anyone; the app and an automated counterparty do the rest.

1. **Sign in with any email.** The app creates an institution for that person on the spot ("<Name> Capital"). Its Privy key quorum is 2-of-3: the judge (trader), the venue's automated compliance co-signer and a reserve key whose public half alone is kept. The app secret cannot sign for the judge, the venue holds only one of the three keys, and the co-signer only ever adds the second signature to an intent the judge has already approved.
2. **The operator side runs by itself** from any page load: fund a Hedera account with 10 HBAR, whitelist and KYC the desk on the ATS register, allocate US$10m par, propose the three desk-signed steps together, and once the association is on-chain, KYC and fund US$15m mock USD. The Institution page shows this as three phases with progress bars (network setup, wallet permissions, funding) and one tile per signature, so nothing appears out of nowhere. The tick also keeps every desk wallet above 8 HBAR, because a Privy-signed transaction must reserve its full gas limit (about 6 HBAR) before the relay accepts it.
3. **The judge signs the three desk steps once:** "Sign all" as trader. The co-signer completes each quorum immediately, Privy executes, and the venue broadcasts them to Hedera one by one.
4. **Trade against the automated desk.** Aldgate Automated Liquidity (quorum: two server-held keys, labelled as automated in the app) always has a buy and a sell RFQ open, quotes any RFQ within about a minute, accepts the best quote on its own RFQs, and approves its side of every trade. The judge publishes an RFQ or quotes one of Aldgate's, then approves the settlement instruction once. The Hedera Schedule Service executes the atomic settlement three minutes after the quote; portfolio and register update.
5. **Reset desk** (header, for the `DESK_RESET_EMAILS` group, self-service desks only) drops the desk record so the next page load provisions a fresh one. Use a plus-alias for test desks; your main email stays Meridian's trader.

Everything above runs without a long-lived process: the market tick runs after API responses (`after()` in Next) at most every 20 seconds, so any page load drives the market. Locally, `npx tsx scripts/market-tick.mts` from `web/` runs one tick by hand.

### Hosting prerequisites

- Vercel environment: everything in `.env.example`, including `AUTOMATED_DESK_KEYS` (printed once by `scripts/provision-automated-desk.mts`) and the two Upstash Redis variables. Vercel's filesystem is ephemeral; with the Redis variables set the JSON store persists institutions, trades and the market log there.
- Privy dashboard: allowlist off, "+" in emails allowed, the deployed domain in allowed origins.
- The automated desks are provisioned once, locally, with `npx tsx scripts/provision-automated-desk.mts` in `web/`; the operator account pays roughly 10 HBAR per new judge desk plus a 20 HBAR gas top-up whenever any desk wallet drops under 8 HBAR.
