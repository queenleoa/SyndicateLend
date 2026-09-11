import { createRequire } from "node:module";
import { Contract, JsonRpcProvider, Wallet, parseEther, MaxUint256, Interface } from "ethers";
import { AccountId, Client, PrivateKey, TokenGrantKycTransaction, TokenId, TokenMintTransaction, TransferTransaction } from "@hashgraph/sdk";
import { readOrg, writeOrg, type Institution } from "./org";
import { venue } from "./venue";
import { HEDERA_RPC, HASHSCAN } from "./hedera";
import { proposeDeskTx, fetchIntent, broadcastIntent, signedTxOf } from "./desk-tx";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const iasset = require("@hashgraph/asset-tokenization-contracts/artifacts/contracts/facets/IAsset.sol/IAsset.json");
const erc20 = new Interface(["function approve(address spender, uint256 value) returns (bool)", "function allowance(address o, address s) view returns (uint256)", "function balanceOf(address a) view returns (uint256)"]);
const hrc719 = new Interface(["function associate() returns (uint256)"]);

const MIRROR = process.env.HEDERA_MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";

/**
 * Bringing a Privy desk wallet onto the Hedera venue. Steps run by the administrative agent
 * (operator key) are plain calls; steps that need the desk's own signature are Privy intents the
 * desk quorum approves, after which the venue broadcasts the signed transaction.
 *
 *   fund            operator sends HBAR (creates the Hedera account for the EVM address)
 *   eligibility     operator whitelists + KYCs the desk on the ATS tranche
 *   allocate        operator issues opening par to the desk (sellers / holders)
 *   usdAssociate    DESK intent: mUSD.associate()            (HIP-719; required before KYC)
 *   usdKyc          operator grants mUSD KYC, then transfers opening cash
 *   allowLoan       DESK intent: loanToken.approve(engine, max)  standing authorisation
 *   allowUsd        DESK intent: mUSD.approve(engine, max)
 */
export interface HederaOnboarding {
  accountId?: string;
  fundTx?: string;
  eligibilityTx?: string;
  allocateTx?: string;
  allocatedPar?: string;
  usdAssociate?: DeskStep;
  usdKycTx?: string;
  usdFundTx?: string;
  usdFunded?: string;
  allowLoan?: DeskStep;
  allowUsd?: DeskStep;
}
export interface DeskStep {
  intentId: string;
  status?: string;
  signatures?: number;
  threshold?: number;
  txHash?: string;
  error?: string;
}

function operator() {
  return new Wallet(process.env.OPERATOR_PRIVATE_KEY!, new JsonRpcProvider(HEDERA_RPC, undefined, { staticNetwork: true }));
}
function hederaClient() {
  const c = Client.forTestnet();
  c.setOperator(AccountId.fromString(process.env.OPERATOR_ACCOUNT_ID!), PrivateKey.fromStringECDSA(process.env.OPERATOR_PRIVATE_KEY!));
  return c;
}
function mockUsdTokenId(): string {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../ops/deployments/testnet.json"), "utf8")).mockUsd.tokenId;
}
async function accountIdFor(evm: string): Promise<string | null> {
  const r = await fetch(`${MIRROR}/api/v1/accounts/${evm}`, { cache: "no-store" });
  return r.ok ? ((await r.json()) as { account: string }).account : null;
}
function inst(id: string): Institution {
  const i = readOrg().institutions.find((x) => x.id === id);
  if (!i?.wallet) throw new Error("institution has no desk wallet");
  return i;
}
function save(id: string, mutate: (h: HederaOnboarding) => void) {
  return writeOrg((o) => {
    const i = o.institutions.find((x) => x.id === id)!;
    const h = ((i as Institution & { hedera?: HederaOnboarding }).hedera ??= {});
    mutate(h);
  });
}
export function onboardingOf(i: Institution): HederaOnboarding {
  return (i as Institution & { hedera?: HederaOnboarding }).hedera ?? {};
}

export async function fund(id: string, hbar = "25") {
  const i = inst(id);
  const tx = await operator().sendTransaction({ to: i.wallet!.address, value: parseEther(hbar) });
  await tx.wait();
  let accountId: string | null = null;
  for (let n = 0; n < 15 && !accountId; n++) {
    accountId = await accountIdFor(i.wallet!.address);
    if (!accountId) await new Promise((r) => setTimeout(r, 1500));
  }
  save(id, (h) => {
    h.fundTx = tx.hash;
    h.accountId = accountId ?? undefined;
  });
  return { txHash: tx.hash, accountId };
}

export async function eligibility(id: string, grant = true) {
  const i = inst(id);
  const d = new Contract(venue().loanToken, iasset.abi, operator());
  const now = Math.floor(Date.now() / 1000);
  let last = "";
  if (grant) {
    const a = await d.getFunction("addToControlList")(i.wallet!.address, { gasLimit: 1_000_000 });
    await a.wait();
    const k = await d.getFunction("grantKyc")(i.wallet!.address, `kyc:${id}`, now, now + 365 * 86400, await operator().getAddress(), { gasLimit: 1_500_000 });
    await k.wait();
    last = k.hash;
  } else {
    const k = await d.getFunction("revokeKyc")(i.wallet!.address, { gasLimit: 1_000_000 });
    await k.wait();
    const a = await d.getFunction("removeFromControlList")(i.wallet!.address, { gasLimit: 1_000_000 });
    await a.wait();
    last = a.hash;
  }
  save(id, (h) => (h.eligibilityTx = last));
  writeOrg((o) => {
    const x = o.institutions.find((y) => y.id === id) as Institution & { loanEligible?: boolean };
    x.loanEligible = grant;
  });
  return { txHash: last, eligible: grant };
}

export async function allocate(id: string, par: string) {
  const i = inst(id);
  const d = new Contract(venue().loanToken, iasset.abi, operator());
  const tx = await d.getFunction("issue")(i.wallet!.address, BigInt(par), "0x", { gasLimit: 1_500_000 });
  await tx.wait();
  save(id, (h) => {
    h.allocateTx = tx.hash;
    h.allocatedPar = (BigInt(h.allocatedPar ?? "0") + BigInt(par)).toString();
  });
  return { txHash: tx.hash };
}

/** Propose a desk-signed step (intent). */
export async function proposeDeskStep(id: string, step: "usdAssociate" | "allowLoan" | "allowUsd") {
  const i = inst(id);
  const v = venue();
  const spec = {
    usdAssociate: { to: v.mockUsd, data: hrc719.encodeFunctionData("associate", []), gas: 1_000_000 },
    allowLoan: { to: v.loanToken, data: erc20.encodeFunctionData("approve", [v.settlementEngine, MaxUint256]), gas: 1_500_000 },
    allowUsd: { to: v.mockUsd, data: erc20.encodeFunctionData("approve", [v.settlementEngine, MaxUint256]), gas: 1_000_000 },
  }[step];
  const h = onboardingOf(i);
  const pendingSteps = (["usdAssociate", "allowLoan", "allowUsd"] as const).filter((s) => h[s] && !h[s]!.txHash && !["rejected", "expired"].includes(h[s]!.status ?? "")).length;
  const intent = await proposeDeskTx({ walletId: i.wallet!.id, walletAddress: i.wallet!.address, to: spec.to, data: spec.data, gasLimit: spec.gas, extraPendingNonce: pendingSteps });
  save(id, (hh) => (hh[step] = { intentId: intent.intent_id, status: intent.status, signatures: 0, threshold: intent.authorization_details[0]?.threshold }));
  return intent.intent_id;
}

/** Operator: grant mUSD KYC and transfer opening cash. Requires the association to be on-chain. */
export async function fundUsd(id: string, usdWhole: string) {
  const i = inst(id);
  const h = onboardingOf(i);
  if (!h.accountId) throw new Error("desk account not created yet (fund first)");
  const client = hederaClient();
  const key = PrivateKey.fromStringECDSA(process.env.OPERATOR_PRIVATE_KEY!);
  const token = TokenId.fromString(mockUsdTokenId());
  const acct = AccountId.fromString(h.accountId);
  const kycTx = await (await new TokenGrantKycTransaction().setAccountId(acct).setTokenId(token).freezeWith(client).sign(key)).execute(client);
  await kycTx.getReceipt(client);
  let fundTx: string | undefined;
  const units = BigInt(usdWhole) * 1_000_000n;
  if (units > 0n) {
    const mint = await (await new TokenMintTransaction().setTokenId(token).setAmount(units).freezeWith(client).sign(key)).execute(client);
    await mint.getReceipt(client);
    const xfer = await new TransferTransaction().addTokenTransfer(token, AccountId.fromString(process.env.OPERATOR_ACCOUNT_ID!), -units).addTokenTransfer(token, acct, units).execute(client);
    await xfer.getReceipt(client);
    fundTx = xfer.transactionId.toString();
  }
  client.close();
  save(id, (hh) => {
    hh.usdKycTx = kycTx.transactionId.toString();
    hh.usdFundTx = fundTx;
    hh.usdFunded = (BigInt(hh.usdFunded ?? "0") + BigInt(usdWhole)).toString();
  });
  return { kycTx: kycTx.transactionId.toString(), fundTx };
}

/** Refresh desk-step intents; broadcast executed ones. */
export async function syncOnboarding(id: string) {
  const i = inst(id);
  const h = onboardingOf(i);
  const out: string[] = [];
  for (const step of ["usdAssociate", "allowLoan", "allowUsd"] as const) {
    const s = h[step];
    if (!s || s.txHash) continue;
    try {
      const intent = await fetchIntent(s.intentId);
      const q = intent.authorization_details[0];
      const upd: DeskStep = { ...s, status: intent.status, signatures: q?.members.filter((m) => m.signed_at).length ?? 0, threshold: q?.threshold };
      if (intent.status === "executed" && signedTxOf(intent)) {
        const r = await broadcastIntent(intent);
        upd.txHash = r.hash;
        upd.error = r.status === 1 ? undefined : "reverted";
        out.push(`${step}: ${r.link}`);
      }
      save(id, (hh) => (hh[step] = upd));
    } catch (e) {
      save(id, (hh) => (hh[step] = { ...s, error: (e as Error).message.slice(0, 200) }));
    }
  }
  return out;
}

/** Live balances for a desk wallet. */
export async function deskBalances(address: string) {
  const p = new JsonRpcProvider(HEDERA_RPC, undefined, { staticNetwork: true });
  const v = venue();
  const loan = new Contract(v.loanToken, iasset.abi, p);
  const usd = new Contract(v.mockUsd, erc20, p);
  const [hbar, par, cash, loanAllowance, usdAllowance] = await Promise.all([
    p.getBalance(address),
    loan.getFunction("balanceOf")(address).catch(() => 0n),
    usd.balanceOf(address).catch(() => 0n),
    loan.getFunction("allowance")(address, v.settlementEngine).catch(() => 0n),
    usd.allowance(address, v.settlementEngine).catch(() => 0n),
  ]);
  return { hbar: hbar.toString(), par: par.toString(), usd: cash.toString(), loanAllowance: loanAllowance.toString(), usdAllowance: usdAllowance.toString(), hashscan: `${HASHSCAN}/account/${address}` };
}
