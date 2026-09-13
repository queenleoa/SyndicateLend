/** Shared, side-effect-free classification for the inbox and notification badges. */
export type ApprovalKind = "setup" | "trade";
export type ApprovalMember = { type: string; user_id?: string; public_key?: string; signed_at: number | null };
export type ApprovalIntent = {
  /** Replaced in the local setup workflow; its original Privy status is retained. */
  superseded?: boolean;
  intent_id: string;
  intent_type: string;
  status: string;
  created_at: number;
  expires_at: number;
  authorization_details: { threshold: number; members: ApprovalMember[] }[];
  request_details: { body: { method?: string; params?: { transaction?: { to?: string; data?: string; chain_id?: number; nonce?: number } } } };
  action_result?: { status_code: number; executed_at: number; response_body?: { data?: { signed_transaction?: string } } };
};
export type SetupIntentRecord = {
  usdAssociate?: { intentId: string };
  allowLoan?: { intentId: string };
  allowUsd?: { intentId: string };
  intentHistory?: { intentId: string; step: "usdAssociate" | "allowLoan" | "allowUsd" }[];
};
export const setupTitles = {
  usdAssociate: "Enable the wallet to receive payment tokens",
  allowLoan: "Authorise loan-token delivery at settlement",
  allowUsd: "Authorise payment at settlement",
};
export const barePrivyId = (id?: string) => (id ?? "").replace(/^did:privy:/, "");

export function setupIntentMap(record: SetupIntentRecord): Record<string, string> {
  const ids: Record<string, string> = Object.create(null);
  for (const old of record.intentHistory ?? []) ids[old.intentId] = setupTitles[old.step];
  for (const step of ["usdAssociate", "allowLoan", "allowUsd"] as const) {
    if (record[step]?.intentId) ids[record[step]!.intentId] = setupTitles[step];
  }
  return ids;
}

export function supersededSetupIntentIds(record: SetupIntentRecord): Set<string> {
  const active = new Set([record.usdAssociate?.intentId, record.allowLoan?.intentId, record.allowUsd?.intentId]);
  return new Set((record.intentHistory ?? []).map((old) => old.intentId).filter((id) => !active.has(id)));
}

export function approvalKind(intentId: string, setup: Record<string, string>): ApprovalKind {
  return Object.prototype.hasOwnProperty.call(setup, intentId) ? "setup" : "trade";
}

export function hasSigned(intent: ApprovalIntent, userId: string): boolean {
  return intent.authorization_details.some((q) => q.members.some((m) =>
    m.type === "user" && barePrivyId(m.user_id) === barePrivyId(userId) && m.signed_at != null));
}

/** Only a still-needed signature from this user's own membership is actionable. */
export function canApprove(intent: ApprovalIntent, userId: string, now = Date.now()): boolean {
  if (!userId || intent.superseded || intent.status !== "pending" || !Number.isFinite(intent.expires_at) || intent.expires_at <= now || hasSigned(intent, userId)) return false;
  return intent.authorization_details.some((q) =>
    q.members.filter((m) => m.signed_at != null).length < q.threshold &&
    q.members.some((m) => m.type === "user" && barePrivyId(m.user_id) === barePrivyId(userId)));
}

export type ApprovalNotifications = {
  total: number;
  setup: number;
  trade: number;
  checkedAt: number;
  items: { intentId: string; kind: ApprovalKind; title: string; href: string }[];
};

export function notificationSummary(intents: ApprovalIntent[], userId: string, setup: Record<string, string>, now = Date.now()): ApprovalNotifications {
  const unique = new Map(intents.map((intent) => [intent.intent_id, intent]));
  const items = [...unique.values()].filter((intent) => canApprove(intent, userId, now)).map((intent) => {
    const kind = approvalKind(intent.intent_id, setup);
    return { intentId: intent.intent_id, kind, title: kind === "setup" ? setup[intent.intent_id] : "Institutional transaction approval", href: `${kind === "setup" ? "/institution" : "/approvals"}#intent-${encodeURIComponent(intent.intent_id)}` };
  });
  return { total: items.length, setup: items.filter((i) => i.kind === "setup").length, trade: items.filter((i) => i.kind === "trade").length, items, checkedAt: now };
}
