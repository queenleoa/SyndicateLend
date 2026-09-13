import { Transaction } from "ethers";
import { readOrg, writeOrg } from "./org";
import { deskStepSpec, onboardingOf, proposeDeskStep, recordDeskStep, type HederaOnboarding } from "./onboarding";
import { fetchIntent, signedTxOf, type IntentView } from "./desk-tx";
import { transactionOutcome, walletNonce } from "./hedera";
import { HttpError } from "./privy-server";
import { SETUP_STEPS, matchesSetupPermission, setupRecoveryDecision, type SetupStep, type SetupPermissionIntent } from "./setup-recovery";
import { withInstitutionApprovalWrite } from "./sync-institution-approvals";
import { listWalletIntents, rejectIntent } from "./approvals";
import { venue } from "./venue";

/** Only re-proposes the recorded setup permission. It never signs, funds or mints. */
export async function retrySetupApproval(institutionId: string, step: SetupStep, reviewedIntentId: string) {
  return withInstitutionApprovalWrite(institutionId, async () => {
    const institution = readOrg().institutions.find((i) => i.id === institutionId);
    if (!institution?.wallet || institution.automated) throw new HttpError(403, "Only your own human institution's setup can be retried here.");
    const onboarding = onboardingOf(institution);
    const current = onboarding[step];
    if (!current || current.intentId !== reviewedIntentId) throw new HttpError(409, "This setup approval has changed. Refresh and review its replacement.");
    if (current.txHash && !current.error) throw new HttpError(409, "This setup step is already confirmed; it will not be repeated.");
    for (const earlier of SETUP_STEPS.slice(0, SETUP_STEPS.indexOf(step))) {
      if (!onboarding[earlier]?.txHash || onboarding[earlier]?.error) throw new HttpError(409, "Complete the earlier wallet setup approval first.");
    }
    const intent = await fetchIntent(current.intentId);
    if (intent.resource_id !== institution.wallet.id) throw new HttpError(403, "This intent does not belong to your institution wallet.");
    const signed = signedTxOf(intent);
    const tx = signed ? Transaction.from(signed) : null;
    if (tx && tx.from?.toLowerCase() !== institution.wallet.address.toLowerCase()) throw new HttpError(403, "The signed transaction belongs to another wallet.");
    const outcome = tx?.hash ? await transactionOutcome(tx.hash) : null;
    const decision = setupRecoveryDecision(intent.status, Boolean(signed), outcome);
    if (decision === "complete") {
      writeOrg((org) => {
        const inst = org.institutions.find((i) => i.id === institutionId)!;
        const h = (inst as typeof inst & { hedera: HederaOnboarding }).hedera;
        h[step] = { ...current, txHash: tx!.hash!, status: intent.status, error: undefined, errorCode: undefined };
      });
      return { message: "The original transaction is confirmed. No replacement was created." };
    }
    // Older onboarding code could overwrite a perfectly valid lower-nonce setup intent.
    // Restore only an exact wallet/chain/calldata match, preserving that intent's own signatures.
    const expected = await walletNonce(institution.wallet.address);
    const candidates = await listWalletIntents(institution.wallet.id);
    for (const item of candidates) {
      const candidate = item as unknown as IntentView & SetupPermissionIntent & { expires_at: number };
      if (candidate.intent_id === current.intentId || !matchesSetupPermission(candidate, institution.wallet.id, deskStepSpec(step), venue().chainId)) continue;
      if (!["pending", "granted", "processing", "executed"].includes(candidate.status)) continue;
      if (candidate.status === "pending" && candidate.expires_at <= Date.now()) continue;
      const raw = signedTxOf(candidate);
      const parsed = raw ? Transaction.from(raw) : null;
      if (parsed && (parsed.from?.toLowerCase() !== institution.wallet.address.toLowerCase() || parsed.to?.toLowerCase() !== deskStepSpec(step).to.toLowerCase() || parsed.data.toLowerCase() !== deskStepSpec(step).data.toLowerCase() || parsed.value !== 0n || parsed.chainId !== BigInt(venue().chainId))) continue;
      const nonce = parsed?.nonce ?? Number(candidate.request_details?.body?.params?.transaction?.nonce);
      if (!Number.isSafeInteger(nonce) || nonce > expected) continue;
      const receipt = parsed?.hash ? await transactionOutcome(parsed.hash) : null;
      if (receipt?.status === 0 || (receipt?.status !== 1 && nonce !== expected)) continue;
      // An abandoned pending duplicate still reserves a nonce in Privy. Withdraw only exact
      // copies of this setup permission, never an unrelated trade or another wallet's action.
      for (const old of candidates) {
        if (old.intent_id === candidate.intent_id || old.status !== "pending") continue;
        const duplicate = old as unknown as SetupPermissionIntent;
        if (!matchesSetupPermission(duplicate, institution.wallet.id, deskStepSpec(step), venue().chainId)) continue;
        await rejectIntent(old.intent_id);
        writeOrg((org) => {
          const inst = org.institutions.find((i) => i.id === institutionId)!;
          const h = (inst as typeof inst & { hedera: HederaOnboarding }).hedera;
          if (!(h.intentHistory ?? []).some((entry) => entry.intentId === old.intent_id)) (h.intentHistory ??= []).push({ intentId: old.intent_id, step });
        });
      }
      const quorum = candidate.authorization_details[0];
      recordDeskStep(institutionId, step, {
        intentId: candidate.intent_id, status: candidate.status,
        signatures: quorum?.members.filter((member) => member.signed_at != null).length ?? 0, threshold: quorum?.threshold,
        txHash: receipt?.status === 1 ? parsed!.hash! : undefined,
      });
      return { intentId: candidate.intent_id, message: receipt?.status === 1 ? "An earlier matching approval is confirmed on Hedera. Setup restored without another transaction." : "The existing correct-nonce setup approval has been restored. Its signatures are preserved; complete its quorum or check approved transactions to execute it." };
    }
    if (decision === "wait") throw new HttpError(409, "The original transaction has no confirmed failure yet. Check approved transactions again; an unresolved transaction will not be replaced.");
    const intentId = await proposeDeskStep(institutionId, step, true);
    return { intentId, message: "Replacement approval requested with the current wallet nonce. The institution's quorum must approve it again." };
  });
}
