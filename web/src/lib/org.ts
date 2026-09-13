
import { jsonStore } from "./store";

/**
 * Institution directory for the demo. In production this is a proper database; here it is a JSON
 * file so judges can read exactly what was provisioned in Privy (ids only, no secrets).
 */
export type Role = "trader" | "compliance" | "pm";
export const ROLE_LABEL: Record<Role, string> = { trader: "Trader", compliance: "Compliance officer", pm: "Portfolio manager" };

export interface Member {
  email: string;
  role: Role;
  privyUserId?: string;
}

export interface Institution {
  id: string; // slug, e.g. "meridian"
  name: string;
  members: Member[];
  /** Privy key quorum of the members' user ids; threshold 2 of 3. */
  keyQuorumId?: string;
  /** Privy organisation wallet owned by the key quorum (EVM). */
  wallet?: { id: string; address: string };
  /** Privy policy restricting the desk wallet to the settlement venue contracts. */
  policyId?: string;
  /** Automated liquidity desk: the quorum is two server-held keys, so it quotes, accepts and approves without people. */
  automated?: boolean;
  /** Self-service desk created at a judge's first sign-in. */
  selfService?: boolean;
  createdAt?: number;
}

export interface OrgFile {
  institutions: Institution[];
}

const store = jsonStore<OrgFile>("org", { institutions: [] });

export function readOrg(): OrgFile {
  return store.read();
}

export function writeOrg(mutate: (o: OrgFile) => void): OrgFile {
  return store.write(mutate);
}

export function findMember(o: OrgFile, privyUserId: string): { institution: Institution; member: Member } | null {
  for (const institution of o.institutions) {
    const member = institution.members.find((m) => m.privyUserId === privyUserId);
    if (member) return { institution, member };
  }
  return null;
}
