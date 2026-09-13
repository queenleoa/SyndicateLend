/** Preparing wallet intents is not a second request for already-recorded agent consent. */
export function assignmentNeedsConsent(trade: { state?: string; consent?: { status: string } }): boolean {
  if (["Settled", "Cancelled", "Failed"].includes(trade.state ?? "")) return false;
  if (trade.consent?.status === "granted") return false;
  return trade.consent?.status === "pending" || trade.state === "AwaitingAgentConsent" || trade.state === "PreparingApprovals";
}
