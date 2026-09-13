
import { PrivyClient } from "@privy-io/node";
import { hydrate } from "./store";

/** Server-side Privy client. The app secret never leaves the server. */
let client: PrivyClient | null = null;
export function privy(): PrivyClient {
  if (!client) {
    const appId = process.env.PRIVY_APP_ID ?? process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const appSecret = process.env.PRIVY_APP_SECRET;
    if (!appId || !appSecret) throw new Error("PRIVY_APP_ID / PRIVY_APP_SECRET not configured");
    client = new PrivyClient({ appId, appSecret });
  }
  return client;
}

/** Extract the Privy access token from a request (Authorization: Bearer or privy-token cookie). */
export function accessTokenFrom(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7);
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)privy-token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export interface Session {
  userId: string;
  accessToken: string;
}

/** Verify the caller's Privy session. Throws on missing/invalid token. */
export async function requireSession(req: Request): Promise<Session> {
  await hydrate();
  const token = accessTokenFrom(req);
  if (!token) throw new HttpError(401, "not signed in");
  try {
    const claims = await privy().utils().auth().verifyAccessToken(token);
    return { userId: claims.user_id, accessToken: token };
  } catch {
    throw new HttpError(401, "invalid session");
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function jsonError(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  const msg = e instanceof Error ? e.message : String(e);
  return Response.json({ error: msg }, { status: 500 });
}
