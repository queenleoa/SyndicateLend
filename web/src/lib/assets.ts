import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { HEDERA_RPC } from "./hedera";
import { readOrg } from "./org";
import { hostedRead } from "./demo/hosted-store";
import { colourFor } from "./agent";

/**
 * The agent bank's register is organised as one credit agreement with several assets issued under it
 * (the term-loan tranches, the revolver, the delayed-draw facility, and whatever a judge issues from the
 * wizard). Every asset is its own ATS security; the lenders' pars are that security's balances.
 *
 * Sources, in display order: assets issued from the browser (newest first, read from the issuance
 * store), then the assets the ops scripts issued (ops/deployments/testnet.json).
 */
export type AssetSource = "issued" | "prepared";
export interface Asset {
  symbol: string;
  name: string;
  isin: string;
  evmAddress: string;
  tokenId: string | null;
  principal: string; // units issued at issuance (1 unit = US$1 par)
  maturity: number; // unix seconds
  facilityType: string;
  rateBps: number | null;
  documentRef: string;
  createTx: string | null;
  createdAt: number; // ms
  source: AssetSource;
  issuedBy?: string;
  /** Wired into the settlement venue (engine whitelisted, desk policies allow it): RFQ transfers settle on it. */
  tradeable: boolean;
  allocations: { evmAddress: string; par: string; issueTx?: string }[];
}

export interface CreditAgreement { name: string; borrower: string; agentBank: string; dated: string; documentRef: string; governingLaw: string }

export type HolderKind = "desk" | "automated" | "anchor" | "feeder" | "self-service" | "agent";
export interface HolderEntry { id: string; name: string; kind: HolderKind; wallet: string | null; wallets: string[]; accountId?: string; colour: string; mine: boolean }

type Deployment = {
  operator: { accountId: string; evmAddress: string };
  creditAgreement?: CreditAgreement;
  loanToken: Record<string, unknown> & { symbol: string; name: string; isin: string; evmAddress: string; tokenId: string; units: string; maturity: number; documentRef: string; createTx: string; startingDate?: number; rateBps?: number; facilityType?: string };
  assets?: { symbol: string; name: string; isin: string; evmAddress: string; tokenId: string; units: string; maturity: number; documentRef: string; createTx: string; startingDate?: number; rateBps?: number; issuedAt?: string; allocations?: { evmAddress: string; par: string; issueTx: string }[] }[];
  institutions?: { name: string; role: string; evmAddress: string; accountId?: string; loanEligible?: boolean }[];
  feeder?: { name?: string; holders?: { evmAddress: string; accountId: string }[] };
  registerSnapshot?: { address: string };
  settlementEngine: { address: string };
  topics: { rfq: string; notices: string };
  mockUsd: { tokenId: string; evmAddress: string; decimals: number; symbol: string };
};

export function readDeployment(): Deployment {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../ops/deployments/testnet.json"), "utf8")) as Deployment;
}

export function creditAgreement(dep = readDeployment()): CreditAgreement {
  return dep.creditAgreement ?? { name: "Meridian Holdings Senior Secured Credit Agreement", borrower: "Meridian Holdings Ltd", agentBank: "SyndicateLend Agent Bank", dated: "2026-09-10", documentRef: dep.loanToken.documentRef, governingLaw: "English law (synthetic demo)" };
}

function facilityTypeOf(symbol: string, name: string, recorded?: string) {
  if (recorded) return recorded;
  const n = `${symbol} ${name}`.toLowerCase();
  if (n.includes("revolv") || n.includes("rcf")) return "Revolving Credit Facility";
  if (n.includes("delayed") || n.includes("ddtl")) return "Delayed Draw Term Loan";
  if (n.includes("incremental")) return "Incremental Term Loan";
  if (n.includes("term loan") || n.includes("tlb")) return "Term Loan B";
  return "Tranche";
}

/** Completed browser issuances, stored durably by web/src/lib/issuance.ts. Shape kept minimal here. */
type IssuedRecord = { id: string; owner: string; terms: { name: string; symbol: string; principal: string; maturityDate: string; documentRef: string; rateBps?: number; facilityType?: string; allocations?: { wallet: string; par: string }[] }; isin: string; agent: string; createdAt: string; securityAddress?: string; tokenId?: string; completedAt?: string; steps: { key: string; op?: string; state: string; hash?: string; target?: string }[] };

export async function issuedAssets(): Promise<Asset[]> {
  const state = await hostedRead<{ records: IssuedRecord[] }>("issuance-state").catch(() => null);
  return (state?.records ?? []).filter((r) => r.completedAt && r.securityAddress).map((r) => ({
    symbol: r.terms.symbol,
    name: r.terms.name,
    isin: r.isin,
    evmAddress: r.securityAddress!,
    tokenId: r.tokenId ?? null,
    principal: r.terms.principal,
    maturity: Math.floor(Date.parse(`${r.terms.maturityDate}T00:00:00Z`) / 1000),
    facilityType: facilityTypeOf(r.terms.symbol, r.terms.name, r.terms.facilityType),
    rateBps: r.terms.rateBps ?? null,
    documentRef: r.terms.documentRef,
    createTx: r.steps.find((s) => s.key === "create")?.hash ?? null,
    createdAt: Date.parse(r.completedAt!),
    source: "issued" as const,
    issuedBy: r.owner,
    tradeable: false,
    allocations: (r.terms.allocations ?? []).map((a) => ({ evmAddress: a.wallet.toLowerCase(), par: a.par, issueTx: r.steps.find((s) => s.op === "issue" && s.target?.toLowerCase() === a.wallet.toLowerCase())?.hash })),
  })).sort((a, b) => b.createdAt - a.createdAt);
}

export function preparedAssets(dep = readDeployment()): Asset[] {
  const t = dep.loanToken;
  const first: Asset = {
    symbol: t.symbol, name: t.name, isin: t.isin, evmAddress: t.evmAddress, tokenId: t.tokenId, principal: t.units, maturity: t.maturity,
    facilityType: facilityTypeOf(t.symbol, t.name, t.facilityType), rateBps: t.rateBps ?? null, documentRef: t.documentRef, createTx: t.createTx,
    createdAt: (t.startingDate ?? 0) * 1000, source: "prepared", tradeable: true, allocations: [],
  };
  const rest: Asset[] = (dep.assets ?? []).map((a) => ({
    symbol: a.symbol, name: a.name, isin: a.isin, evmAddress: a.evmAddress, tokenId: a.tokenId, principal: a.units, maturity: a.maturity,
    facilityType: facilityTypeOf(a.symbol, a.name), rateBps: a.rateBps ?? null, documentRef: a.documentRef, createTx: a.createTx,
    createdAt: a.issuedAt ? Date.parse(a.issuedAt) : (a.startingDate ?? 0) * 1000, source: "prepared", tradeable: false,
    allocations: (a.allocations ?? []).map((x) => ({ evmAddress: x.evmAddress.toLowerCase(), par: x.par, issueTx: x.issueTx })),
  }));
  return [first, ...rest];
}

export async function listAssets(dep = readDeployment()): Promise<Asset[]> {
  const issued = await issuedAssets();
  const prepared = preparedAssets(dep).filter((p) => !issued.some((i) => i.evmAddress.toLowerCase() === p.evmAddress.toLowerCase()));
  return [...issued, ...prepared];
}

export function findAsset(assets: Asset[], symbolOrAddress: string | null | undefined): Asset | null {
  if (!symbolOrAddress) return null;
  const key = symbolOrAddress.toLowerCase();
  return assets.find((a) => a.symbol.toLowerCase() === key || a.evmAddress.toLowerCase() === key) ?? null;
}

/** Every wallet that can appear on a register: desks, anchor lenders, the agent bank itself, retail feeder holders (one line). */
export function holderDirectory(dep = readDeployment(), myInstitutionId: string | null = null): HolderEntry[] {
  const org = readOrg();
  const out: HolderEntry[] = [];
  for (const i of org.institutions) {
    if (!i.wallet) continue;
    const hedera = (i as { hedera?: { accountId?: string } }).hedera;
    out.push({ id: i.id, name: i.name, kind: i.automated ? "automated" : i.selfService ? "self-service" : "desk", wallet: i.wallet.address, wallets: [i.wallet.address.toLowerCase()], accountId: hedera?.accountId, colour: "", mine: myInstitutionId === i.id });
  }
  for (const a of dep.institutions ?? []) {
    if (a.role === "outsider") continue;
    if (out.some((h) => h.wallets.includes(a.evmAddress.toLowerCase()))) continue;
    // An institution can hold par in more than one account: fold the treasury account onboarded by
    // script into the same lender line as its Privy desk wallet.
    const same = out.find((h) => h.name.trim().toLowerCase() === a.name.trim().toLowerCase());
    if (same) { same.wallets.push(a.evmAddress.toLowerCase()); continue; }
    out.push({ id: `anchor:${a.evmAddress.toLowerCase()}`, name: a.name, kind: "anchor", wallet: a.evmAddress, wallets: [a.evmAddress.toLowerCase()], accountId: a.accountId, colour: "", mine: false });
  }
  out.push({ id: "agent", name: `${creditAgreement(dep).agentBank} (unallocated)`, kind: "agent", wallet: dep.operator.evmAddress, wallets: [dep.operator.evmAddress.toLowerCase()], accountId: dep.operator.accountId, colour: "#8a94a6", mine: false });
  const feeder = dep.feeder;
  if (feeder?.holders?.length) {
    out.push({ id: "feeder", name: `${feeder.name ?? "Feeder"} pass-through (${feeder.holders.length} retail holders)`, kind: "feeder", wallet: null, wallets: feeder.holders.map((h) => h.evmAddress.toLowerCase()), colour: "", mine: false });
  }
  out.forEach((h) => { if (!h.colour) h.colour = colourFor([...h.id].reduce((sum, c) => sum + c.charCodeAt(0), 0)); });
  return out;
}

const SNAPSHOT_ABI = ["function snapshot(address token, address[] holders) view returns (uint256[] out, uint256 total)"];
const TOKEN_ABI = ["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"];

/** Balances of `wallets` on one asset in a single call through RegisterSnapshot (falls back to balanceOf). */
export async function assetBalances(asset: Pick<Asset, "evmAddress">, wallets: string[], dep = readDeployment()): Promise<{ balances: Map<string, bigint | null>; totalSupply: bigint | null }> {
  const provider = new JsonRpcProvider(HEDERA_RPC, undefined, { staticNetwork: true, batchMaxCount: 1 });
  const balances = new Map<string, bigint | null>();
  try {
    const token = new Contract(asset.evmAddress, TOKEN_ABI, provider);
    const totalSupply: bigint | null = await token.totalSupply().catch(() => null);
    const unique = [...new Set(wallets.map((w) => w.toLowerCase()))];
    let read = false;
    if (dep.registerSnapshot?.address && unique.length) {
      try {
        const [out] = await new Contract(dep.registerSnapshot.address, SNAPSHOT_ABI, provider).snapshot(asset.evmAddress, unique) as [bigint[], bigint];
        unique.forEach((w, i) => balances.set(w, out[i]));
        read = true;
      } catch { /* fall back to individual reads */ }
    }
    if (!read) {
      for (let start = 0; start < unique.length; start += 4) {
        await Promise.all(unique.slice(start, start + 4).map(async (w) => balances.set(w, await token.balanceOf(w).then((n: bigint) => n).catch(() => null))));
      }
    }
    return { balances, totalSupply };
  } finally { provider.destroy(); }
}
