"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { IntentDetails, OPEN, ROLE, SignerDots, describeIntent, signerRows, useApprovalInbox, type InstitutionApprovalPayload } from "./approvals-inbox";
import { HASHSCAN, PrivyMark, short, when } from "./ui";
import { approvalKind, barePrivyId, canApprove, hasSigned, type ApprovalIntent } from "@/lib/approval-notifications";
import styles from "./institution-workspace.module.css";

type Step = NonNullable<InstitutionApprovalPayload["onboarding"]>["steps"][number];
type Inbox = ReturnType<typeof useApprovalInbox>;

const STEP: Record<string, string> = { wallet: "Create institutional wallet", account: "Fund the Hedera account", eligible: "Grant ATS eligibility", par: "Allocate opening loan position", usdAssociate: "Enable payment-token receipts", allowLoan: "Authorise loan-token settlement", allowUsd: "Authorise cash settlement", cash: "Fund the payment balance" };
const NETWORK: Record<string, { short: string; doing: string }> = { wallet: { short: "Wallet", doing: "Creating the institutional wallet…" }, account: { short: "Account", doing: "Funding the Hedera account…" }, eligible: { short: "Eligibility", doing: "Granting ATS eligibility…" }, par: { short: "Position", doing: "Allocating the opening loan position…" } };
const NETWORK_KEYS = ["wallet", "account", "eligible", "par"];
const DESK_KEYS = ["usdAssociate", "allowLoan", "allowUsd"];

export function InstitutionWorkspace() {
  const inbox = useApprovalInbox();
  const data = inbox.data;
  const institution = data?.institution;
  const onboarding = data?.onboarding;
  const quorum = institution?.quorum;
  const signerTotal = quorum ? quorum.userIds.length + quorum.keys : 0;
  const quorumRows = data ? signerRows(null, data) : [];
  const intents = new Map((data?.intents ?? []).map((i) => [i.intent_id, i]));
  const desk = DESK_KEYS.map((key) => onboarding?.steps.find((s) => s.key === key)).filter((s): s is Step => Boolean(s));
  const setupToSign = desk.map((s) => (s.intentId ? intents.get(s.intentId) : undefined)).filter((i): i is ApprovalIntent => Boolean(i && data && canApprove(i, data.me.userId))).map((i) => i.intent_id);
  return <div className={styles.workspace}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Institution · Identity, wallet & permissions</p><h1>{institution?.name ?? "Your institution"}</h1><p>Set up the institution once. Approve every asset movement together.</p></div><Image src="/integrations/privy.png" alt="Privy" width={110} height={40} className={styles.privy} /></header>
    <div className={styles.toolbar}><span className={onboarding?.ready ? styles.ready : styles.status}>{onboarding?.ready ? "Ready to trade" : "Institutional setup"}</span><div className={styles.buttons}><button className={styles.secondary} disabled={inbox.busy !== null} onClick={() => void inbox.syncApproved()}>{inbox.busy === "execution-sync" ? "Checking execution…" : "Check approved transactions"}</button><button className={styles.secondary} onClick={() => void inbox.refresh()}>Refresh</button><Link className={styles.primary} href="/issue">Go to Loan Registry →</Link></div></div>
    {inbox.error && <div className={styles.error} role="alert">{inbox.error} <button className={styles.textButton} onClick={() => void inbox.refresh()}>Try again</button></div>}
    {inbox.notice && <p role="status">{inbox.notice}</p>}
    {!data ? <p className={styles.empty}>Loading institution and approval requests…</p> : !institution ? <div className={styles.empty}>Your institution is being prepared after sign-in. You can open Loan Registry while setup completes.<button className={styles.textButton} onClick={() => void inbox.refresh()}>Check again</button></div> : <>
      <div className={styles.overview}>
        <section className={styles.walletCard}><div className={styles.sectionHeader}><h2>Institutional wallet</h2><Image src="/integrations/hedera.svg" alt="Hedera" width={95} height={28} /></div><p className={styles.address}><a href={`${HASHSCAN}/account/${institution.wallet.address}`} target="_blank" rel="noreferrer">{short(institution.wallet.address, 10, 8)} ↗</a></p><details className={styles.policyDetails}><summary>Wallet identifiers</summary><dl className={styles.metadata}><div><dt>Wallet ID</dt><dd>{institution.wallet.id}</dd></div><div><dt>Quorum</dt><dd>{institution.keyQuorumId ?? "Not configured"}</dd></div></dl></details></section>
        <section className={styles.card}><div className={styles.sectionHeader}><h2>Approval policy</h2><PrivyMark /></div><div className={styles.bigMetric}>{quorum?.threshold != null && signerTotal > 0 ? <>{quorum.threshold} of {signerTotal}<span>{institution.cosigner === "automated" ? `signatures · ${quorumRows.map((r) => r.label.toLowerCase()).join(", ")}` : "member approvals"}</span></> : <span>Live quorum unavailable</span>}</div><details className={styles.policyDetails}><summary>Wallet restrictions</summary>{institution.cosigner === "automated" ? <p>You sign once. The venue’s automated compliance co-signer adds the second signature after checking the intent{institution.reserveSigner ? "; the reserve key is a cold standby" : ""}. No single key can move the wallet.</p> : quorum?.threshold != null && <p>{quorum.threshold > 1 ? "A single trader cannot authorise the institution’s wallet alone." : "Privy enforces the configured signature threshold."}</p>}{institution.policyId ? <ul><li>Hedera testnet venue contracts only</li><li>Settlement-engine approvals only for token allowances</li><li>Private-key export denied</li></ul> : <p>No wallet policy is recorded.</p>}<span>Recorded policy ID: {institution.policyId ?? "Not configured"}</span></details></section>
        <section className={styles.card}><div className={styles.sectionHeader}><h2>Authorised team</h2><PrivyMark /></div><p className={styles.currentRole}>{ROLE[data.me.role] ?? data.me.role} <span>· Your role</span></p><details className={styles.policyDetails}><summary>View {institution.members.length + (institution.cosigner === "automated" ? 1 : 0) + (institution.reserveSigner ? 1 : 0)} quorum members</summary><ul className={styles.team}>{institution.members.map((member) => {
          const isMe = barePrivyId(member.privyUserId) === barePrivyId(data.me.userId);
          const inQuorum = quorum?.userIds.some((id) => barePrivyId(id) === barePrivyId(member.privyUserId));
          return <li key={member.email}><span className={styles.initial}>{member.email.slice(0, 1).toUpperCase()}</span><div><strong>{ROLE[member.role] ?? member.role}{isMe ? " · You" : ""}</strong><span>{member.email}</span>{quorum && !inQuorum && <span>Not a quorum signer</span>}</div></li>;
        })}{institution.cosigner === "automated" && <li><span className={styles.initial}>⚙</span><div><strong>Automated compliance co-signer</strong><span>Venue-held P-256 key · co-signs after the trader</span></div></li>}{institution.reserveSigner && <li><span className={styles.initial}>◆</span><div><strong>Reserve key</strong><span>Cold-standby P-256 key · {short(institution.reserveSigner, 8, 6)}</span></div></li>}</ul></details></section>
      </div>
      <WalletSetup inbox={inbox} data={data} desk={desk} setupToSign={setupToSign} />
    </>}
  </div>;
}

/** Wallet setup as one horizontal process: network setup (agent bank), the desk's three signatures, funding. */
function WalletSetup({ inbox, data, desk, setupToSign }: { inbox: Inbox; data: InstitutionApprovalPayload; desk: Step[]; setupToSign: string[] }) {
  const [showHistory, setShowHistory] = useState(false);
  const steps = data.onboarding?.steps ?? [];
  const network = NETWORK_KEYS.map((key) => steps.find((s) => s.key === key)).filter((s): s is Step => Boolean(s));
  const cash = steps.find((s) => s.key === "cash");
  const networkDone = network.filter((s) => s.state === "done").length;
  const networkActive = network.find((s) => s.state !== "done");
  const deskDone = desk.filter((s) => s.state === "done").length;
  const done = steps.filter((s) => s.state === "done").length;
  const networkPhase = networkDone === network.length ? "done" : "active";
  const deskPhase = deskDone === desk.length ? "done" : networkPhase === "done" ? "active" : "pending";
  const fundingPhase = cash?.state === "done" ? "done" : deskPhase === "done" || desk[0]?.state === "done" ? "active" : "pending";
  const intents = new Map(data.intents.map((i) => [i.intent_id, i]));
  const closed = data.intents.filter((i) => approvalKind(i.intent_id, data.setupIntents ?? {}) === "setup" && (i.superseded || !OPEN.has(i.status)));
  const phaseClass = (p: string) => p === "done" ? styles.phaseDone : p === "active" ? styles.phaseActive : styles.phasePending;
  return <section id="setup-approvals" className={styles.setup}>
    <div className={styles.setupHeader}>
      <div><h2>Wallet setup</h2><p>{data.onboarding?.ready ? "Complete. The institution can trade its own assets." : deskPhase === "active" ? (setupToSign.length ? `${setupToSign.length} wallet permission${setupToSign.length === 1 ? "" : "s"} waiting for your signature.` : "Signatures received. Executing and broadcasting to Hedera…") : networkPhase === "active" ? "The agent bank is completing network setup. Your signatures come next." : "Funding the payment balance…"}</p></div>
      <div className={styles.setupHeaderRight}><span className={styles.progressCount}>{done} / {steps.length || "—"} steps</span>{setupToSign.length > 1 && <button className={styles.primary} disabled={inbox.busy !== null} onClick={() => void inbox.act(setupToSign, "authorize")}>{inbox.busy === "setup-batch" ? "Signing with Privy…" : <>Sign all {setupToSign.length} with <PrivyMark height={20} /></>}</button>}</div>
    </div>
    <ol className={styles.phases}>
      <li className={`${styles.phase} ${phaseClass(networkPhase)}`}>
        <b><i aria-hidden>{networkPhase === "done" ? "✓" : "1"}</i>Network setup<span>Agent bank</span></b>
        <div className={styles.bar}><i style={{ width: `${(networkDone / Math.max(1, network.length)) * 100}%` }} /></div>
        <ul className={styles.ticks}>{network.map((s) => <li key={s.key} className={s.state === "done" ? styles.tickDone : s.key === networkActive?.key ? styles.tickActive : ""}>{NETWORK[s.key]?.short ?? s.label}</li>)}</ul>
        <small>{networkPhase === "done" ? "Wallet funded, eligible and holding its opening position" : networkActive ? NETWORK[networkActive.key]?.doing ?? networkActive.label : "Preparing…"}</small>
      </li>
      <li className={`${styles.phase} ${phaseClass(deskPhase)}`}>
        <b><i aria-hidden>{deskPhase === "done" ? "✓" : "2"}</i>Wallet permissions<span>Your signatures · {data.institution?.quorum?.threshold ?? 2} of {(data.institution?.quorum?.userIds.length ?? 0) + (data.institution?.quorum?.keys ?? 0) || 3} quorum</span></b>
        <div className={styles.bar}><i style={{ width: `${(deskDone / Math.max(1, desk.length)) * 100}%` }} /></div>
        <ul className={styles.ticks}>{desk.map((s, index) => <li key={s.key} className={s.state === "done" ? styles.tickDone : s.intentId && intents.get(s.intentId) && setupToSign.includes(s.intentId) ? styles.tickActive : ""}>Permission {index + 1}</li>)}</ul>
        <small>{deskPhase === "done" ? "All three permissions executed on Hedera" : deskPhase === "pending" ? "Prepared once network setup completes" : setupToSign.length ? "Waiting for your signature" : `${deskDone} of ${desk.length} executed`}</small>
      </li>
      <li className={`${styles.phase} ${phaseClass(fundingPhase)}`}>
        <b><i aria-hidden>{fundingPhase === "done" ? "✓" : "3"}</i>Funding<span>Agent bank</span></b>
        <div className={styles.bar}><i style={{ width: fundingPhase === "done" ? "100%" : "0%" }} /></div>
        <ul className={styles.ticks}><li className={fundingPhase === "done" ? styles.tickDone : fundingPhase === "active" ? styles.tickActive : ""}>Payment balance</li></ul>
        <small>{fundingPhase === "done" ? "Opening payment balance received" : fundingPhase === "active" ? "Granting payment-token KYC and funding…" : "After payment-token receipts are enabled"}</small>
      </li>
    </ol>
    <div className={styles.tiles}>{desk.map((step, index) => <SetupTile key={step.key} step={step} index={index + 1} intent={step.intentId ? intents.get(step.intentId) ?? null : null} inbox={inbox} data={data} />)}</div>
    {closed.length > 0 && <div className={styles.history}><button className={styles.textButton} onClick={() => setShowHistory(!showHistory)}>{showHistory ? "Hide" : "Show"} {closed.length} completed or closed setup actions</button>{showHistory && <ul>{closed.map((intent) => <li key={intent.intent_id}><span>{describeIntent(intent, data).title}</span><b>{intent.superseded ? "Superseded" : intent.status}</b><time>{when(intent.created_at)}</time></li>)}</ul>}</div>}
  </section>;
}

/** One desk-signed permission: always on screen, moving from "prepared later" to signed, executed and done. */
function SetupTile({ step, index, intent, inbox, data }: { step: Step; index: number; intent: ApprovalIntent | null; inbox: Inbox; data: InstitutionApprovalPayload }) {
  const me = data.me.userId;
  const done = step.state === "done";
  const actionable = intent ? canApprove(intent, me) : false;
  const mine = intent ? hasSigned(intent, me) : false;
  const rows = signerRows(intent, data);
  const threshold = intent?.authorization_details[0]?.threshold ?? data.institution?.quorum?.threshold ?? null;
  const phase = done ? "done" : step.canRetry ? "failed" : !intent ? "waiting" : actionable ? "sign" : "executing";
  const status = done ? "Executed on Hedera"
    : step.canRetry ? step.detail ?? "This approval needs recovering"
    : !intent ? "Prepared once network setup completes"
    : actionable ? "Needs your signature"
    : mine && intent.status === "pending" ? "Signed by you · compliance co-signer completing the quorum…"
    : intent.status === "pending" ? (intent.expires_at <= Date.now() ? "Approval expired · recover it below" : "Awaiting quorum signatures")
    : OPEN.has(intent.status) ? "Approved · broadcasting to Hedera…"
    : `Privy status: ${intent.status}`;
  const tileClass = { done: styles.tileDone, failed: styles.tileFailed, waiting: styles.tileWaiting, sign: styles.tileSign, executing: styles.tileExecuting }[phase];
  return <article id={intent ? `intent-${intent.intent_id}` : undefined} className={`${styles.tile} ${tileClass}`}>
    <div className={styles.tileTop}><i aria-hidden>{done ? "✓" : index}</i><strong>{STEP[step.key] ?? step.label}</strong>{intent && !done && <span className={styles.status}>{intent.status}</span>}</div>
    <SignerDots rows={rows} threshold={threshold} muted={phase === "waiting"} />
    <p className={phase === "failed" ? styles.tileError : undefined}>{status}</p>
    <div className={styles.tileActions}>
      {phase === "failed" && step.intentId && <button className={styles.secondary} disabled={inbox.busy !== null} onClick={() => void inbox.retrySetup(step.key, step.intentId!)}>{inbox.busy === `retry-${step.key}` ? "Recovering…" : "Recover approval"}</button>}
      {phase === "sign" && intent && <button className={styles.primary} disabled={inbox.busy !== null} onClick={() => void inbox.act([intent.intent_id], "authorize")}>{inbox.busy === intent.intent_id || inbox.busy === "setup-batch" ? "Signing with Privy…" : <>Approve with <PrivyMark height={18} /></>}</button>}
      {phase === "sign" && intent && ["compliance", "pm"].includes(data.me.role) && <button className={styles.reject} disabled={inbox.busy !== null} onClick={() => void inbox.act([intent.intent_id], "reject")}>Reject</button>}
      {intent && <IntentDetails intent={intent} />}
    </div>
  </article>;
}
