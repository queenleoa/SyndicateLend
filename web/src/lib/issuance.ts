import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Contract, FetchRequest, JsonRpcProvider, Transaction, Wallet, type TransactionReceipt } from "ethers";
import { HostedDemoError, hostedRead, hostedStorageConfigured, hostedWrite, hostedWriteAndReleaseOperator, withHostedLeaseWait, type HostedLease } from "./demo/hosted-store";
import { assetInterface, DEFAULT_PARTITION, encodeLoanCreation, factoryInterface, resolveAtsAddress } from "./issuance-contract";
import { issuanceCap, issuanceIsin, issuanceSteps, unallocated, validateIssuanceTerms, type IssuanceLender, type IssuanceStatus, type IssuanceStep, type IssuanceView } from "./issuance-spec";
import { holderDirectory, listAssets, readDeployment } from "./assets";
import { createAndCommit, findNotice } from "./notices";

type StoredStep = IssuanceStep & { signedTransaction?: string };
type StoredIssuance = Omit<IssuanceView, "steps"> & { owner: string; resolver: string; startingDate: number; steps: StoredStep[] };
type State = { records: StoredIssuance[] };
const STORE = "issuance-state";
const MAX_BROADCASTS = 12;
type Workflow = { kind: "issuance" | "registry"; id: string };

async function reserveOperator(id: string, lease: HostedLease) {
  const active = await hostedRead<Workflow>("operator-workflow");
  if (active && (active.kind !== "issuance" || active.id !== id)) throw new HostedDemoError(409, "The agent bank is completing another workflow. Try again in a moment.");
  if (!active) await hostedWrite("operator-workflow", { kind: "issuance", id }, lease);
}

async function saveProgress(state: State, record: StoredIssuance, lease: HostedLease) {
  // Only a definitive chain receipt or full verified completion can free this signer for another workflow.
  if (record.completedAt || record.steps.some((s) => s.state === "failed")) await hostedWriteAndReleaseOperator(STORE, state, lease, { kind: "issuance", id: record.id });
  else await hostedWrite(STORE, state, lease);
}

function availability(userId: string): string | null {
  if (process.env.ISSUANCE_DEMO_ENABLED === "false") return "Live issuance has been disabled by the host.";
  if ((process.env.HEDERA_NETWORK ?? "testnet") !== "testnet") return "This issuance wizard is restricted to Hedera testnet.";
  if (!process.env.OPERATOR_PRIVATE_KEY) return "The host must configure the testnet agent signing account.";
  const allowed = (process.env.PLATFORM_ADMIN_PRIVY_USER_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (process.env.ISSUANCE_DEMO_ALLOW_JUDGES === "false" && !allowed.includes(userId)) return "Live issuance is restricted to the host's agent accounts.";
  return null;
}

const active = (r: StoredIssuance) => !r.completedAt && !r.steps.some((s) => s.state === "failed" || s.state === "review");

function view(r: StoredIssuance): IssuanceView {
  return {
    id: r.id, terms: r.terms, isin: r.isin, agent: r.agent, factory: r.factory, createdAt: r.createdAt,
    securityAddress: r.securityAddress, tokenId: r.tokenId, totalSupply: r.totalSupply, agentBalance: r.agentBalance, completedAt: r.completedAt,
    steps: r.steps.map(({ key, op, label, target, amount, state, hash, attempts }) => ({ key, op, label, target, amount, state, hash, attempts })),
  };
}

/** Lenders a new asset can be allocated to: every institution with a wallet plus the anchor lenders. */
export function issuanceLenders(myInstitutionId: string | null = null): IssuanceLender[] {
  return holderDirectory(readDeployment(), myInstitutionId).filter((h) => h.wallet && h.kind !== "agent" && h.kind !== "feeder").map((h) => ({ id: h.id, name: h.name, wallet: h.wallet!, kind: h.kind, mine: h.mine }));
}

async function takenSymbols(state: State | null) {
  const assets = await listAssets().catch(() => []);
  return [...new Set([...assets.map((a) => a.symbol), ...(state?.records ?? []).filter((r) => r.completedAt || active(r)).map((r) => r.terms.symbol)])];
}

export async function issuanceStatus(userId: string, myInstitutionId: string | null = null): Promise<IssuanceStatus> {
  const reason = availability(userId);
  const state = hostedStorageConfigured() ? await hostedRead<State>(STORE) : null;
  // The user's newest issuance: an unfinished one resumes; a completed one is shown until they start another.
  const mine = (state?.records ?? []).filter((r) => r.owner === userId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
  return { enabled: reason === null, reason, remaining: Math.max(0, issuanceCap(process.env.ISSUANCE_DEMO_LIMIT) - (state?.records.length ?? 0)), record: mine ? view(mine) : null, lenders: issuanceLenders(myInstitutionId), takenSymbols: await takenSymbols(state) };
}

export async function beginIssuance(userId: string, value: unknown) {
  const reason = availability(userId);
  if (reason) throw new HostedDemoError(403, reason);
  return withHostedLeaseWait("operator-transactions", 30_000, async (lease) => {
    const workflow = await hostedRead<Workflow>("operator-workflow");
    if (workflow?.kind === "registry") throw new HostedDemoError(409, "Complete the active market demo before starting a loan issuance.");
    const state = await hostedRead<State>(STORE) ?? { records: [] };
    const unfinished = state.records.find((r) => r.owner === userId && active(r));
    if (unfinished) return view(unfinished); // Resume rather than start a second security.
    if (state.records.some((r) => r.owner !== userId && active(r))) throw new HostedDemoError(409, "Another loan issuance is in progress. Try again in a minute.");
    if (state.records.length >= issuanceCap(process.env.ISSUANCE_DEMO_LIMIT)) throw new HostedDemoError(409, "This deployment has reached its funded issuance limit. The register and the prepared assets remain available.");
    let terms;
    try { terms = validateIssuanceTerms(value, Date.now(), await takenSymbols(state)); } catch (e) { throw new HostedDemoError(400, (e as Error).message); }
    const lenders = issuanceLenders();
    for (const a of terms.allocations) if (!lenders.some((l) => l.wallet.toLowerCase() === a.wallet)) throw new HostedDemoError(400, "Allocate only to lenders on the register.");
    const agent = new Wallet(process.env.OPERATOR_PRIVATE_KEY!).address;
    const mirror = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
    const [factory, resolver] = await Promise.all([
      resolveAtsAddress(process.env.ATS_FACTORY ?? "0.0.9213391", mirror),
      resolveAtsAddress(process.env.ATS_RESOLVER ?? "0.0.9212226", mirror),
    ]);
    const id = randomUUID();
    const names = Object.fromEntries(lenders.map((l) => [l.wallet.toLowerCase(), l.name]));
    const record: StoredIssuance = {
      id, owner: userId, terms, isin: issuanceIsin(createHash("sha256").update(id).digest("hex")), agent, factory, resolver,
      startingDate: 0, createdAt: new Date().toISOString(), steps: issuanceSteps(terms, names),
    };
    state.records.push(record);
    await hostedWrite(STORE, state, lease);
    await reserveOperator(record.id, lease);
    return view(record);
  });
}

function chain() {
  const request = new FetchRequest(process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api");
  request.timeout = 12_000;
  return new JsonRpcProvider(request, undefined, { staticNetwork: true, batchMaxCount: 1 });
}

async function confirmReceipt(record: StoredIssuance, step: StoredStep, receipt: TransactionReceipt) {
  if (receipt.status !== 1) { step.state = "failed"; return; }
  if (step.op === "create") {
    const event = receipt.logs.filter((log) => log.address.toLowerCase() === record.factory.toLowerCase())
      .map((log) => { try { return factoryInterface.parseLog(log); } catch { return null; } })
      .find((log) => log?.name === "BondDeployed" && String(log.args.deployer).toLowerCase() === record.agent.toLowerCase());
    if (!event) { step.state = "review"; return; }
    record.securityAddress = String(event.args.bondAddress);
    record.tokenId = await contractId(record.securityAddress);
  }
  step.state = "confirmed";
}

async function contractId(evmAddress: string): Promise<string | undefined> {
  try {
    const mirror = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
    const response = await fetch(`${mirror}/api/v1/contracts/${evmAddress}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return response.ok ? ((await response.json()) as { contract_id?: string }).contract_id : undefined;
  } catch { return undefined; }
}

/** One bounded step per browser POST; signed bytes are durably recorded BEFORE broadcast. */
export async function advanceIssuance(userId: string, id: string) {
  const reason = availability(userId);
  if (reason) throw new HostedDemoError(403, reason);
  return withHostedLeaseWait("operator-transactions", 30_000, async (lease) => {
    const state = await hostedRead<State>(STORE) ?? { records: [] };
    const record = state.records.find((r) => r.id === id && r.owner === userId);
    if (!record) throw new HostedDemoError(404, "Issuance not found for this account.");
    if (record.completedAt) return view(record);
    if (record.steps.some((s) => s.state === "failed" || s.state === "review")) throw new HostedDemoError(409, "This issuance needs host review. Its existing transaction receipts are preserved; no replacement security will be created.");
    await reserveOperator(record.id, lease);
    const step = record.steps.find((s) => s.state !== "confirmed");
    if (!step) {
      const provider = chain();
      try { await verifyPrincipal(record, provider); } finally { provider.destroy(); }
      await saveProgress(state, record, lease);
      return view(record);
    }
    if (step.op === "notice") {
      await commitNotice(record, step);
      await hostedWrite(STORE, state, lease);
      return view(record);
    }
    const provider = chain();
    try {
      if ((await provider.getNetwork()).chainId !== 296n) throw new HostedDemoError(403, "The configured RPC is not Hedera testnet. No transaction was signed.");
      const signer = new Wallet(process.env.OPERATOR_PRIVATE_KEY!, provider);
      if (signer.address.toLowerCase() !== record.agent.toLowerCase()) throw new HostedDemoError(409, "The configured agent account changed. Restore the original signer before continuing.");
      if (step.hash) {
        const existing = await provider.getTransactionReceipt(step.hash);
        if (existing) {
          await confirmReceipt(record, step, existing);
          await saveProgress(state, record, lease);
          return view(record);
        }
      }
      if (step.attempts >= MAX_BROADCASTS) {
        step.state = "review";
        await hostedWrite(STORE, state, lease);
        return view(record);
      }
      if (!step.signedTransaction) {
        const { to, data, gasLimit } = stepTransaction(record, step);
        // Cap even the maximum fee of a single operation; the deployment-wide cap also bounds total creations.
        const [nonce, fees, balance] = await Promise.all([provider.getTransactionCount(signer.address, "pending"), provider.getFeeData(), provider.getBalance(signer.address)]);
        const gasPrice = fees.gasPrice;
        if (!gasPrice || gasPrice * gasLimit > 30n * 10n ** 18n) throw new HostedDemoError(503, "Testnet fees exceed the demo safety limit. No transaction was signed.");
        if (balance < gasPrice * gasLimit) throw new HostedDemoError(503, "The host must fund the agent account with testnet HBAR before this step can be signed.");
        const signed = await signer.signTransaction({ to, data, gasLimit, gasPrice, nonce, chainId: 296, type: 0, value: 0 });
        step.signedTransaction = signed;
        step.hash = Transaction.from(signed).hash!;
        step.state = "pending";
        await hostedWrite(STORE, state, lease);
      }
      step.attempts += 1;
      await saveProgress(state, record, lease);
      await lease.assertOwned();
      // Re-broadcasting the identical signed bytes is safe across request retries and cold starts.
      try { await provider.broadcastTransaction(step.signedTransaction); } catch { /* receipt is authoritative, including "already known" and ambiguous RPC timeouts */ }
      let receipt = await provider.getTransactionReceipt(step.hash!);
      for (let wait = 0; !receipt && wait < 4; wait++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        receipt = await provider.getTransactionReceipt(step.hash!);
      }
      if (receipt) await confirmReceipt(record, step, receipt);
      await saveProgress(state, record, lease);
      return view(record);
    } finally { provider.destroy(); }
  });
}

function stepTransaction(record: StoredIssuance, step: StoredStep) {
  const now = Math.floor(Date.now() / 1000);
  if (step.op === "create") {
    record.startingDate = now + 120;
    // Terms may have aged while the browser was closed; validate again before signing creation.
    validateIssuanceTerms(record.terms);
    return { to: record.factory, data: encodeLoanCreation(record.terms, record.agent, record.resolver, record.isin, record.startingDate), gasLimit: 15_000_000n };
  }
  if (!record.securityAddress) throw new HostedDemoError(409, "The ATS creation receipt has not been confirmed.");
  const engine = readDeployment().settlementEngine.address;
  const maturity = Math.floor(Date.parse(`${record.terms.maturityDate}T00:00:00Z`) / 1000) + 86_400;
  const holder = step.target ?? record.agent;
  const calls: Record<Exclude<typeof step.op, "create" | "notice">, [string, unknown[]]> = {
    issuer: ["addIssuer", [record.agent]],
    whitelist: ["addToControlList", [holder]],
    kyc: ["grantKyc", [holder, `synthetic:${record.id}:${holder.slice(2, 10)}`, now - 60, maturity, record.agent]],
    engine: ["addToControlList", [engine]],
    issue: ["issueByPartition", [{ partition: DEFAULT_PARTITION, tokenHolder: holder, value: step.amount, data: "0x" }]],
    mint: ["issueByPartition", [{ partition: DEFAULT_PARTITION, tokenHolder: record.agent, value: step.amount, data: "0x" }]],
  };
  const [method, parameters] = calls[step.op as keyof typeof calls];
  return { to: record.securityAddress, data: assetInterface.encodeFunctionData(method, parameters), gasLimit: 1_500_000n };
}

/** The rate notice is the private input to the CRE calculation; only its salted commitment goes on-chain. */
async function commitNotice(record: StoredIssuance, step: StoredStep) {
  const symbol = record.terms.symbol;
  const existing = findNotice(symbol, 1);
  if (existing) { step.state = "confirmed"; step.hash = existing.hcs?.transactionId; return; }
  step.attempts += 1;
  const now = Math.floor(Date.now() / 1000);
  const notice = await createAndCommit({ facilityId: symbol, periodStart: now - 30 * 86_400, periodEnd: now, rateBps: record.terms.rateBps, dayCountBasis: 360 });
  step.hash = notice.hcs?.transactionId;
  step.state = "confirmed";
}

async function verifyPrincipal(record: StoredIssuance, provider: JsonRpcProvider) {
  const token = new Contract(record.securityAddress!, assetInterface, provider);
  const [supply, balance, kyc] = await Promise.all([token.totalSupply(), token.balanceOf(record.agent), token.getKycStatusFor(record.agent)]);
  record.totalSupply = String(supply);
  record.agentBalance = String(balance);
  const remainder = unallocated(record.terms).toString();
  if (String(supply) !== record.terms.principal || String(balance) !== remainder || Number(kyc) !== 1) throw new HostedDemoError(409, "Transactions confirmed, but the issued principal does not match the expected register. The host must review the receipts.");
  record.completedAt = new Date().toISOString();
}
