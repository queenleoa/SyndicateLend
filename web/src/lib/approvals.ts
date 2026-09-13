import { formatRequestForAuthorizationSignature, generateAuthorizationSignature, type WalletApiRequestSignatureInput } from "@privy-io/node";
import { privy } from "./privy-server";
import { proposeDeskTx } from "./desk-tx";

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

export async function proposeSignTransaction(input: ProposeInput & { walletAddress: string }) {
  return proposeDeskTx({ walletId: input.walletId, walletAddress: input.walletAddress, to: input.to, data: input.data, gasLimit: input.gasLimit ?? 1_000_000 });
}

/** Add the calling user's authorisation to an intent (one of the quorum members). */
export async function authorizeIntent(intentId: string, userJwt: string) {
  const p = privy();
  const intent = await p.intents().get(intentId);
  const rd = (intent as { request_details: { method: string; url: string; body: unknown } }).request_details;
  const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID!;
  const url = rd.url.startsWith("http") ? rd.url : `${API.replace(/\/v1$/, "")}${rd.url}`;
  // Signed object = intent request + fresh timestamp + intent_id (per the client SDK's input type);
  // the same timestamp is posted with the signature. Variants only differ in the expiry header.
  const timestamp = Date.now();
  const headerVariants: Array<Record<string, string>> = [
    { "privy-app-id": appId },
    { "privy-app-id": appId, "privy-request-expiry": String((intent as { expires_at: number }).expires_at) },
  ];
  const key = await userSigningKeyViaRest(userJwt);
  let last: unknown = null;
  for (const headers of headerVariants) {
    const input = { version: 1, method: rd.method, url, body: rd.body, timestamp, intent_id: intentId, headers } as unknown as WalletApiRequestSignatureInput;
    const signature = generateAuthorizationSignature({ authorizationPrivateKey: key, input: formatRequestForAuthorizationSignature(input) });
    const res = await fetch(`${API}/intents/${intentId}/authorize`, {
      method: "POST",
      headers: basicAuth(),
      body: JSON.stringify({ signature, timestamp }),
    });
    const json = await res.json();
    if (res.ok) return json;
    last = json;
    if (!/signature/i.test(JSON.stringify(json))) break;
  }
  throw new Error(`authorize failed: ${JSON.stringify(last)}`);
}

/** POST /v1/wallets/authenticate without HPKE: returns the user's time-bound P-256 signing key. */
async function userSigningKeyViaRest(userJwt: string): Promise<string> {
  const res = await fetch(`${API}/wallets/authenticate`, { method: "POST", headers: basicAuth(), body: JSON.stringify({ user_jwt: userJwt }) });
  const json = await res.json();
  if (!res.ok || !json.authorization_key) throw new Error(`user key exchange failed: ${JSON.stringify(json)}`);
  return json.authorization_key as string;
}

/** Submit a signature produced client-side (useAuthorizationSignature) for an intent. */
export async function submitIntentSignature(intentId: string, signature: string, timestamp: number) {
  const res = await fetch(`${API}/intents/${intentId}/authorize`, {
    method: "POST",
    headers: basicAuth(),
    body: JSON.stringify({ signature, timestamp }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`authorize failed: ${JSON.stringify(json)}`);
  return json;
}

export async function rejectIntent(intentId: string) {
  // The SDK's reject sends no body and Privy answers 415; call the endpoint with an empty JSON object.
  const res = await fetch(`${API}/intents/${intentId}/reject`, { method: "POST", headers: basicAuth(), body: "{}" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`reject failed: ${JSON.stringify(json)}`);
  return json;
}

export async function listWalletIntents(walletId: string) {
  const page = await privy().intents().list({ resource_id: walletId, sort_by: "created_at_desc", limit: 50 } as never);
  const intents = [];
  for await (const intent of page) intents.push(intent);
  return intents;
}

export async function getIntent(intentId: string) {
  return privy().intents().get(intentId);
}
