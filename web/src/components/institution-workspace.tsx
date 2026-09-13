"use client";

import Image from "next/image";
import Link from "next/link";
import { ApprovalList, useApprovalInbox } from "./approvals-inbox";
import { HASHSCAN, PrivyMark, short } from "./ui";
import { approvalKind, canApprove } from "@/lib/approval-notifications";
import { barePrivyId } from "@/lib/approval-notifications";
import styles from "./institution-workspace.module.css";

const ROLE: Record<string, string> = { trader: "Trader", compliance: "Compliance officer", pm: "Portfolio manager" };
const STEP: Record<string, string> = { wallet: "Create institutional wallet", account: "Fund the Hedera account", eligible: "Grant ATS eligibility", par: "Allocate opening loan position", usdAssociate: "Enable payment-token receipts", allowLoan: "Authorise loan-token settlement", allowUsd: "Authorise cash settlement", cash: "Fund the payment balance" };

export function InstitutionWorkspace() {
  const inbox = useApprovalInbox();
  const institution = inbox.data?.institution;
  const onboarding = inbox.data?.onboarding;
  const quorum = institution?.quorum;
  const setupToSign = (inbox.data?.intents ?? []).filter((i) => approvalKind(i.intent_id, inbox.data?.setupIntents ?? {}) === "setup" && canApprove(i, inbox.data!.me.userId)).map((i) => i.intent_id);
  return <div className={styles.workspace}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Institution · Identity, wallet & permissions</p><h1>{institution?.name ?? "Your institution"}</h1><p>Set up the institution once. Approve every asset movement together.</p></div><Image src="/integrations/privy.png" alt="Privy" width={110} height={40} className={styles.privy} /></header>
    <div className={styles.toolbar}><span className={onboarding?.ready ? styles.ready : styles.status}>{onboarding?.ready ? "Ready to trade" : "Institutional setup"}</span><div className={styles.buttons}><button className={styles.secondary} disabled={inbox.busy !== null} onClick={() => void inbox.syncApproved()}>{inbox.busy === "execution-sync" ? "Checking execution…" : "Check approved transactions"}</button><button className={styles.secondary} onClick={() => void inbox.refresh()}>Refresh</button><Link className={styles.primary} href="/issue">Go to Loan Registry →</Link></div></div>
    {inbox.error && <div className={styles.error} role="alert">{inbox.error} <button className={styles.textButton} onClick={() => void inbox.refresh()}>Try again</button></div>}
    {inbox.notice && <p role="status">{inbox.notice}</p>}
    {!inbox.data ? <p className={styles.empty}>Loading institution and approval requests…</p> : !institution ? <div className={styles.empty}>Your institution is being prepared after sign-in. You can open Loan Registry while setup completes.<button className={styles.textButton} onClick={() => void inbox.refresh()}>Check again</button></div> : <>
      <div className={styles.overview}>
        <section className={styles.walletCard}><div className={styles.sectionHeader}><h2>Institutional wallet</h2><Image src="/integrations/hedera.svg" alt="Hedera" width={95} height={28} /></div><p className={styles.address}><a href={`${HASHSCAN}/account/${institution.wallet.address}`} target="_blank" rel="noreferrer">{short(institution.wallet.address, 10, 8)} ↗</a></p><details className={styles.policyDetails}><summary>Wallet identifiers</summary><dl className={styles.metadata}><div><dt>Wallet ID</dt><dd>{institution.wallet.id}</dd></div><div><dt>Quorum</dt><dd>{institution.keyQuorumId ?? "Not configured"}</dd></div></dl></details></section>
        <section className={styles.card}><div className={styles.sectionHeader}><h2>Approval policy</h2><PrivyMark /></div><div className={styles.bigMetric}>{institution.cosigner === "automated" ? <>You + co-signer<span>2 of 2 signatures</span></> : quorum?.threshold != null ? <>{quorum.threshold} of {quorum.userIds.length}<span>member approvals</span></> : <span>Live quorum unavailable</span>}</div><details className={styles.policyDetails}><summary>Wallet restrictions</summary>{institution.cosigner === "automated" ? <p>You sign once. The venue’s automated compliance co-signer adds the second signature after checking the intent, so no single key can move the wallet.</p> : quorum?.threshold != null && <p>{quorum.threshold > 1 ? "A single trader cannot authorise the institution’s wallet alone." : "Privy enforces the configured signature threshold."}</p>}{institution.policyId ? <ul><li>Hedera testnet venue contracts only</li><li>Settlement-engine approvals only for token allowances</li><li>Private-key export denied</li></ul> : <p>No wallet policy is recorded.</p>}<span>Recorded policy ID: {institution.policyId ?? "Not configured"}</span></details></section>
        <section className={styles.card}><div className={styles.sectionHeader}><h2>Authorised team</h2><PrivyMark /></div><p className={styles.currentRole}>{ROLE[inbox.data.me.role] ?? inbox.data.me.role} <span>· Your role</span></p><details className={styles.policyDetails}><summary>View {institution.members.length + (institution.cosigner === "automated" ? 1 : 0)} quorum members</summary><ul className={styles.team}>{institution.cosigner === "automated" && <li><span className={styles.initial}>⚙</span><div><strong>Automated compliance co-signer</strong><span>Venue-held P-256 key · co-signs after the trader</span></div></li>}{institution.members.map((member) => {
          const isMe = barePrivyId(member.privyUserId) === barePrivyId(inbox.data!.me.userId);
          const inQuorum = quorum?.userIds.some((id) => barePrivyId(id) === barePrivyId(member.privyUserId));
          return <li key={member.email}><span className={styles.initial}>{member.email.slice(0, 1).toUpperCase()}</span><div><strong>{ROLE[member.role] ?? member.role}{isMe ? " · You" : ""}</strong><span>{member.email}</span>{quorum && !inQuorum && <span>Not a quorum signer</span>}</div></li>;
        })}</ul></details></section>
      </div>
      <div className={styles.setupLayout}>
        <aside className={styles.checklist}>
          <div className={styles.sectionHeader}><h2>Wallet setup</h2><span>{onboarding?.steps.filter((step) => step.state === "done").length ?? 0} / {onboarding?.steps.length ?? "—"}</span></div>
          {setupToSign.length > 0 && <button className={styles.primary} disabled={inbox.busy !== null} onClick={() => void inbox.act(setupToSign, "authorize")}>{inbox.busy ? "Signing with Privy…" : <>Sign {setupToSign.length === 1 ? "the setup step" : `all ${setupToSign.length} setup steps`} with <PrivyMark height={20} /></>}</button>}
          <ol>{onboarding?.steps.map((step, index) => <li key={step.key} className={step.state === "done" ? styles.stepDone : step.state === "active" ? styles.stepActive : styles.stepPending}>
            <i aria-hidden>{step.state === "done" ? "✓" : index + 1}</i>
            <div><strong>{STEP[step.key] ?? step.label}</strong>
              <span>{step.state === "done" ? "Complete" : step.needsDesk ? step.detail ?? "Institutional approval required" : "Agent / operator step"}</span>
              {step.intentId && step.state !== "done" && (step.canRetry
                ? <button className={styles.textButton} disabled={inbox.busy !== null} onClick={() => void inbox.retrySetup(step.key, step.intentId!)}>{inbox.busy === `retry-${step.key}` ? "Recovering…" : "Recover setup approval →"}</button>
                : <a href={`#intent-${encodeURIComponent(step.intentId)}`}>{setupToSign.includes(step.intentId) ? "Sign this step below →" : "See approval status →"}</a>)}
            </div>
          </li>)}</ol>
          <p>The agent bank completes network setup; your team approves the wallet permissions. This is required to trade your own assets. You can explore loan issuance, the register and the hosted transfer demo now.</p>
        </aside>
        <ApprovalList inbox={inbox} kind="setup" />
      </div>
    </>}
  </div>;
}
