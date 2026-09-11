import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./data-dir";

/** Append-only JSONL log of verified Privy webhook events (demo persistence; a database in production). */
const file = path.join(dataDir(), "privy-events.jsonl");

export function recordWebhookEvent(event: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ received_at: Date.now(), ...event }) + "\n");
}

export function readWebhookEvents(limit = 200): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((l) => JSON.parse(l));
}
