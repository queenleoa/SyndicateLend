import fs from "node:fs";
import path from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { jsonError } from "@/lib/privy-server";
import { optionalDesk } from "@/lib/desk-auth";
import { HEDERA_RPC } from "@/lib/hedera";

/** How the tranche is configured in Asset Tokenization Studio, with a few live reads from the security. */
const ROLES = [
  { role: "ISSUER", what: "issue par to eligible lenders (allocations)" },
  { role: "CONTROL_LIST", what: "maintain the whitelist of eligible holders" },
  { role: "INTERNAL_KYC_MANAGER", what: "grant and revoke internal KYC" },
  { role: "KYC", what: "read KYC status through the SDK" },
  { role: "PAUSER", what: "pause and unpause all transfers (amendment windows)" },
  { role: "FREEZE_MANAGER", what: "freeze individual holders" },
  { role: "CONTROLLER", what: "forced transfers (not used by the engine, by design)" },
  { role: "CORPORATE_ACTION", what: "corporate actions and distributions" },
  { role: "SSI_MANAGER", what: "self-sovereign identity settings" },
  { role: "CAP", what: "raise the maximum supply (tranche upsizing)" },
];

export async function GET(req: Request) {
  try {
    await optionalDesk(req);
    const dep = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../ops/deployments/testnet.json"), "utf8"));
    const t = dep.loanToken as Record<string, string | number>;
    const provider = new JsonRpcProvider(HEDERA_RPC, undefined, { staticNetwork: true });
    const sec = new Contract(String(t.evmAddress), ["function totalSupply() view returns (uint256)", "function getMaxSupply() view returns (uint256)", "function isPaused() view returns (bool)", "function name() view returns (string)", "function symbol() view returns (string)"], provider);
    const [totalSupply, maxSupply, paused] = await Promise.all([
      sec.totalSupply().then((v: bigint) => v.toString()).catch(() => null),
      sec.getMaxSupply().then((v: bigint) => v.toString()).catch(() => null),
      sec.isPaused().catch(() => null),
    ]);
    return Response.json({
      security: {
        name: t.name, symbol: t.symbol, isin: t.isin, tokenId: t.tokenId, evmAddress: t.evmAddress, decimals: t.decimals, units: t.units, maxSupply: t.maxSupply ?? t.units, maturity: t.maturity, startingDate: t.startingDate,
        documentRef: t.documentRef, createTx: t.createTx, raiseCapTx: t.raiseCapTx ?? null, configId: t.configId, factory: t.factory, resolver: t.resolver,
        type: "Bond-type security (ERC-3643 / ERC-1400 facets on an ATS diamond)", regulation: "Reg S (offshore institutional)", parUnit: "1 token = US$1 of par",
      },
      live: { totalSupply, maxSupply, paused },
      compliance: [
        { control: "Whitelist (control list)", how: "Only addresses on the control list may hold or receive the token; a transfer to any other address reverts." },
        { control: "Internal KYC", how: "The agent grants a KYC record per holder with a validity window; transfers re-check it at execution." },
        { control: "Pause", how: "The agent can pause all transfers, for example during an amendment; demonstrated on testnet." },
        { control: "Freeze", how: "Individual holders can be frozen; demonstrated on the mock-USD leg." },
        { control: "Compliance re-check at settlement", how: "The settlement engine moves par with transferFrom, so every settlement passes the token's own checks; a buyer revoked after approval causes a full revert." },
      ],
      roles: ROLES.map((r) => ({ ...r, holder: dep.operator?.accountId })),
      mockUsd: dep.mockUsd,
      engine: dep.settlementEngine,
      registerSnapshot: dep.registerSnapshot ?? null,
      topics: dep.topics,
      operator: dep.operator,
      lifecycleControls: dep.lifecycleControls ?? null,
      atsInfra: { factory: t.factory, resolver: t.resolver, configId: t.configId, sdk: "@hashgraph/asset-tokenization-sdk 8.0.0" },
    });
  } catch (e) {
    return jsonError(e);
  }
}
