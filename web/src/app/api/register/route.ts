import fs from "node:fs";
import path from "node:path";
import { jsonError } from "@/lib/privy-server";
import { requireDesk } from "@/lib/desk-auth";
import { readOrg, type Institution } from "@/lib/org";
import { deskBalances, onboardingOf } from "@/lib/onboarding";

/** Facility register: tranche metadata from the ops deployment record plus each institution's status. */
export async function GET(req: Request) {
  try {
    await requireDesk(req);
    const dep = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../ops/deployments/testnet.json"), "utf8"));
    const org = readOrg();
    const holders = await Promise.all(
      org.institutions.map(async (i: Institution & { loanEligible?: boolean }) => ({
        id: i.id,
        name: i.name,
        wallet: i.wallet?.address ?? null,
        eligible: i.loanEligible ?? false,
        hedera: onboardingOf(i),
        balances: i.wallet ? await deskBalances(i.wallet.address).catch(() => null) : null,
      })),
    );
    return Response.json({ facility: dep.loanToken, mockUsd: dep.mockUsd, engine: dep.settlementEngine, topics: dep.topics, operator: dep.operator, legacyInstitutions: dep.institutions, holders });
  } catch (e) {
    return jsonError(e);
  }
}
