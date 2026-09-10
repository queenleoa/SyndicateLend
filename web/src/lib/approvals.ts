import { privy } from "./privy-server";
import { venue } from "./venue";

/**
 * Desk approvals = Privy intents on the institution's quorum-owned wallet.
 *
 *  1. A trader proposes an action (an RPC intent to sign a transaction with the desk wallet).
 *     Creation needs only the app secret; nothing is signed yet.
 *  2. Each approver authorises with their own Privy session: the SDK exchanges the user's access
 *     token for a short-lived user signing key and produces a P-256 signature over the intent.
 *  3. When the quorum threshold (2 of 3) is met, Privy executes the action inside its enclave,
 *     subject to the wallet policy (venue contracts on Hedera testnet only).
 */

const API = "https://api.privy.io/v1";

function basicAuth() {
  const id = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
  const secret = process.env.PRIVY_APP_SECRET!;
  return { Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"), "privy-app-id": id, "content-type": "application/json" };
}

export interface ProposeInput {
  walletId: string;
  to: string;
  data: string;
  /** human-readable summary shown in the inbox, e.g. "Approve settlement instruction #3" */
  summary: string;
  gasLimit?: number;
}

export async function proposeSignTransaction(input: ProposeInput) {
  const v = venue();
  return privy().intents().rpc(input.walletId, {
    method: "eth_signTransaction",
    params: {
      transaction: {
        to: input.to,
        data: input.data,
        value: "0x0",
        chain_id: v.chainId,
        gas_limit: input.gasLimit ?? 1_000_000,
        type: 2,
      },
    },
  } as never);
}

/** Add the calling user's authorisation to an intent (one of the quorum members). */
export async function authorizeIntent(intentId: string, userJwt: string) {
  const p = privy();
  const intent = await p.intents().get(intentId);
  const rd = (intent as { request_details: { method: string; url: string; body: unknown } }).request_details;
  const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
  const url = rd.url.startsWith("http") ? rd.url : `${API.replace(/\/v1$/, "")}${rd.url}`;
  // The docs do not say whether the intent-creation expiry header is part of the signed payload,
  // so try the bare request first and fall back to echoing the intent expiry.
  const attempts: Array<Record<string, string>> = [
    { "privy-app-id": appId },
    { "privy-app-id": appId, "privy-request-expiry": String((intent as { expires_at: number }).expires_at) },
  ];
  let last: unknown = null;
  for (const headers of attempts) {
    const [signature] = await p.utils().requestSigner().generateAuthorizationSignatures({
      authorizationContext: { user_jwts: [userJwt] },
      input: { version: 1, method: rd.method as "POST", url, body: rd.body, headers: headers as { "privy-app-id": string } },
    });
    const res = await fetch(`${API}/intents/${intentId}/authorize`, {
      method: "POST",
      headers: basicAuth(),
      body: JSON.stringify({ signature, timestamp: Date.now() }),
    });
    const json = await res.json();
    if (res.ok) return json;
    last = json;
    if (!/signature/i.test(JSON.stringify(json))) break;
  }
  throw new Error(`authorize failed: ${JSON.stringify(last)}`);
}

export async function rejectIntent(intentId: string) {
  return privy().intents().reject(intentId);
}

export async function listWalletIntents(walletId: string) {
  const page = await privy().intents().list({ resource_id: walletId, sort_by: "created_at_desc", limit: 50 } as never);
  return page.getPaginatedItems();
}

export async function getIntent(intentId: string) {
  return privy().intents().get(intentId);
}
