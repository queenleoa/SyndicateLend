---
name: Privy
description: Use when building wallet infrastructure, authentication systems, or financial applications. Reach for Privy when you need to create embedded wallets, authenticate users, manage wallet controls and policies, execute transactions across blockchains, or build financial products with custody options.
metadata:
    mintlify-proj: privy
    version: "1.0"
---

# Privy Skill Reference

## Product summary

Privy is a programmable wallet infrastructure platform for building financial applications. It provides secure embedded wallets, multi-chain transaction execution, flexible authentication, and policy-based access controls. Use Privy to create wallets for users, organizations, treasuries, or AI agents; authenticate users via email, social, passkeys, or wallets; and execute transactions with granular permission controls.

**Key files and configuration:**
- Dashboard: https://dashboard.privy.io (create apps, configure login methods, set policies)
- App ID and App Secret: Required for all API calls (found in dashboard)
- Client ID: Optional, for environment-specific configuration
- REST API base: `https://api.privy.io/v1/`
- SDKs: React, React Native, Swift, Android, Flutter, Unity (client-side); NodeJS, Java, Go, Rust, Ruby, Python (server-side)

**Primary docs:** https://docs.privy.io

## When to use

Reach for Privy when:
- Building consumer apps that need embedded wallets with familiar login (email, social, passkeys)
- Creating organization wallets with multi-party approval workflows
- Managing treasuries or agent wallets with strict policy controls
- Executing transactions across Ethereum, Solana, Tempo, Bitcoin, or 50+ other blockchains
- Implementing multi-factor authentication or biometric verification for wallet access
- Setting up fiat onramps/offramps, card spend, or yield integrations
- Requiring server-side wallet management via API
- Building trading apps with limit orders, automated rebalancing, or delegated signing
- Implementing KYC/KYB compliance for financial products

Do not use Privy for: non-financial applications, simple key storage without transaction execution, or apps that don't need blockchain interaction.

## Quick reference

### SDK Installation

| Platform | Package | Command |
|----------|---------|---------|
| React | `@privy-io/react-auth` | `npm install @privy-io/react-auth` |
| React Native | `@privy-io/react-native` | `npm install @privy-io/react-native` |
| NodeJS | `@privy-io/node` | `npm install @privy-io/node` |
| Python | `privy-python` | `pip install privy-python` |
| Go | `privy-go` | `go get github.com/privy-io/privy-go` |
| Java | `privy-java` | Maven/Gradle dependency |

### Core API Endpoints

| Resource | Method | Endpoint |
|----------|--------|----------|
| Create wallet | POST | `/v1/wallets` |
| Get wallet | GET | `/v1/wallets/{wallet_id}` |
| Create user | POST | `/v1/users` |
| Get user | GET | `/v1/users/{user_id}` |
| Create policy | POST | `/v1/policies` |
| Create intent | POST | `/v1/intents` |
| Send transaction | POST | `/v1/wallets/{wallet_id}/ethereum/eth_sendTransaction` |

### Authentication Methods (Privy-native)

- Email / SMS / WhatsApp (OTP-based)
- Social OAuth (Google, Discord, Twitter, GitHub, TikTok, LinkedIn, Spotify, Instagram)
- Wallet-based (MetaMask, Phantom, Farcaster, Telegram)
- Passkeys (biometric)
- Custom JWT-based (integrate your own auth)

### Wallet Types

| Type | Custody | Use case |
|------|--------|----------|
| Embedded (non-custodial) | User controls keys | Consumer apps, self-custody |
| Embedded (custodial) | Licensed custodian | Institutional, regulated entities |
| External | User's wallet (MetaMask, Phantom) | Power users, existing wallets |
| Organization | Org-owned, multi-sig | Teams, treasuries, businesses |
| Agent | Server-controlled | AI agents, automation, trading bots |

### Control Models

| Model | Owner | Signers | Use case |
|-------|-------|---------|----------|
| User-owned | User | None | Self-custodial wallets |
| User + server | User | Server (scoped) | Limit orders, automation |
| App-owned | Authorization key | None | Treasury, agents |
| Multi-sig | Key quorum | Multiple parties | Approval workflows |

## Decision guidance

### When to use embedded vs. external wallets

| Scenario | Embedded | External |
|----------|----------|----------|
| New users, no wallet | ✓ | ✗ |
| Existing wallet holders | ✗ | ✓ |
| Seamless UX priority | ✓ | ✗ |
| User controls keys | ✓ | ✓ |
| Custody required | ✓ (custodial option) | ✗ |
| Multi-chain support | ✓ | Depends on wallet |

### When to use Privy auth vs. JWT-based auth

| Consideration | Privy Auth | JWT-based |
|---------------|-----------|-----------|
| Multiple login methods | ✓ | ✗ |
| Passkeys/MFA | ✓ | Requires integration |
| Existing auth system | ✗ | ✓ |
| Fastest setup | ✓ | ✗ |
| Custom auth flow | ✗ | ✓ |

### When to use wallet actions vs. RPC vs. intents

| Use case | Wallet Actions | RPC | Intents |
|----------|---|---|---------|
| Transfers, swaps, earn | ✓ | ✗ | ✓ |
| Custom transactions | ✗ | ✓ | ✓ |
| Async approval workflows | ✗ | ✗ | ✓ |
| Simple signing | ✗ | ✓ | ✗ |
| Recommended for most | ✓ | ✗ | ✗ |

## Workflow

### 1. Set up Privy app and authentication

1. Create app in Privy Dashboard (https://dashboard.privy.io)
2. Copy App ID and App Secret
3. Configure login methods (email, social, passkeys, wallet)
4. Set up app clients for different environments if needed
5. Enable MFA if required for security

### 2. Integrate client-side SDK (React example)

1. Install `@privy-io/react-auth`
2. Wrap app with `PrivyProvider` at root level
3. Pass `appId` and `clientId` to provider
4. Configure `embeddedWallets` to auto-create on login if needed
5. Wait for `ready` flag before consuming Privy state
6. Use `usePrivy()` hook to access auth state and login/logout

### 3. Create wallets

**Client-side (React):**
- Use `useCreateWallet()` hook to create on-demand
- Or configure `createOnLogin: 'users-without-wallets'` for auto-creation

**Server-side (NodeJS):**
1. Get user ID (create user first if needed)
2. Call `client.wallets().create({userId, chain: 'ethereum'})`
3. Store wallet ID for future reference

### 4. Execute transactions

**Wallet actions (recommended):**
1. Use `useSendTransaction()` (React) or `client.wallets().ethereum().sendTransaction()` (server)
2. Provide transaction details (to, value, data)
3. Handle signing (user approves on client, or server signs with auth key)

**RPC (custom flows):**
1. Create intent with RPC method
2. Get authorization from wallet owner/signers
3. Execute intent

### 5. Set up policies and controls

1. Define policy in Dashboard or via API
2. Attach policy to signer or authorization key
3. Policy evaluates at request time; blocks unauthorized transactions
4. Test policy with sample transactions

### 6. Monitor with webhooks

1. Register webhook endpoint in Dashboard (Configuration > Webhooks)
2. Subscribe to event types (user.created, wallet.funds_deposited, transaction.confirmed, etc.)
3. Verify webhook signatures using Privy's public key
4. Handle retries (Privy retries failed deliveries)

## Common gotchas

- **HTTPS required for embedded wallets**: Embedded wallets use WebCrypto API, only available in secure contexts (https://). Localhost is treated as secure by browsers.
- **Wait for `ready` flag**: Don't consume Privy state before `ready === true` in React. State may be stale during initialization.
- **App ID vs. App Secret**: App ID is public; App Secret must be kept secure on server only. Never expose App Secret in client code.
- **User key required for server signing**: When signing on server with user's wallet, request ephemeral user key first using user's access token.
- **Policy evaluation is synchronous**: Policies are evaluated in-enclave at request time. Slow policies block transactions; keep them simple.
- **Wallet creation is async**: Wallet creation may take a few seconds. Don't assume wallet exists immediately after creation call.
- **External wallet chains must be configured**: If using external wallets, configure supported chains in Dashboard before users can connect.
- **Idempotency keys prevent double-sends**: Use idempotency keys for critical transactions to prevent accidental duplicates.
- **Rate limits apply**: REST API has rate limits (HTTP 429). Implement exponential backoff retry logic.
- **Custodial wallets require KYC**: Custodial wallets need KYC/KYB verification before use. Plan for compliance workflow.
- **Passkeys are device-specific**: Passkeys are tied to device; users can't use same passkey on multiple devices without re-enrollment.
- **SMS auth has security risks**: SMS is vulnerable to SIM-swapping. Require MFA (passkey or TOTP) if SMS is primary auth method.

## Verification checklist

Before submitting work with Privy:

- [ ] App ID and App Secret are correctly configured (secret not exposed in client code)
- [ ] PrivyProvider wraps app at root level with correct appId
- [ ] `ready` flag is checked before consuming Privy state
- [ ] Wallet creation is tested and wallets persist across sessions
- [ ] Authentication flow works with configured login methods
- [ ] Transactions execute successfully and appear on-chain
- [ ] Policies are attached to signers and block unauthorized transactions
- [ ] Webhook endpoint is registered and receiving events
- [ ] Error handling catches and logs API errors (404, 429, etc.)
- [ ] HTTPS is used in production (not http://)
- [ ] User keys are requested server-side before signing user wallets
- [ ] Idempotency keys are used for critical transactions
- [ ] MFA is enabled if using delegated auth (email, SMS, OAuth)
- [ ] Rate limit retry logic is implemented
- [ ] Wallet addresses are validated before use

## Resources

**Comprehensive navigation:** https://docs.privy.io/llms.txt

**Critical documentation pages:**
1. [Key Concepts](https://docs.privy.io/basics/key-concepts) — Understand authentication, wallets, and controls
2. [React Setup & Quickstart](https://docs.privy.io/basics/react/setup) — Get client-side integration running
3. [REST API Introduction](https://docs.privy.io/api-reference/introduction) — Server-side API reference and authentication

---

> For additional documentation and navigation, see: https://docs.privy.io/llms.txt