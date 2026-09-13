import { requireSession, HttpError } from "./privy-server";
import { findMember, readOrg, type Institution, type Member } from "./org";

export async function requireDesk(req: Request): Promise<{ userId: string; accessToken: string; institution: Institution; member: Member }> {
  const s = await requireSession(req);
  const hit = findMember(readOrg(), s.userId);
  if (!hit) throw new HttpError(403, "your user is not attached to an institution");
  return { ...s, ...hit };
}

/**
 * Read-only access for any signed-in user. Members get their institution; anyone else (a judge signing in
 * with their own email) is an observer: institution and member are null, and write routes still refuse them.
 */
export async function optionalDesk(req: Request): Promise<{ userId: string; accessToken: string; institution: Institution | null; member: Member | null }> {
  const s = await requireSession(req);
  const hit = findMember(readOrg(), s.userId);
  return { ...s, institution: hit?.institution ?? null, member: hit?.member ?? null };
}

export function requireRole(member: Member, roles: Member["role"][], what: string) {
  if (!roles.includes(member.role)) throw new HttpError(403, `${what} requires one of: ${roles.join(", ")}`);
}
