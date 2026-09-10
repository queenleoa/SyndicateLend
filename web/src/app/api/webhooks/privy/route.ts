import { privy } from "@/lib/privy-server";
import { recordWebhookEvent } from "@/lib/webhook-log";

/**
 * Privy webhook receiver (register https://<domain>/api/webhooks/privy in the dashboard).
 * Verifies the Svix signature with the endpoint's signing secret, then records intent lifecycle
 * events so the approvals inbox can show who authorised what and when the action executed.
 */
export async function POST(req: Request) {
  const payload = await req.text(); // raw body: signature is computed over the exact bytes
  const secret = process.env.PRIVY_WEBHOOKS_SIGNING_KEY;
  if (!secret) return Response.json({ error: "PRIVY_WEBHOOKS_SIGNING_KEY not configured" }, { status: 500 });
  let event;
  try {
    event = privy().webhooks().verify({
      payload,
      signing_secret: secret,
      headers: {
        "svix-id": req.headers.get("svix-id") ?? "",
        "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
        "svix-signature": req.headers.get("svix-signature") ?? "",
      },
    });
  } catch {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  recordWebhookEvent(event as unknown as Record<string, unknown>);
  return Response.json({ received: true });
}

export async function GET() {
  return Response.json({ ok: true, endpoint: "privy webhooks" });
}
