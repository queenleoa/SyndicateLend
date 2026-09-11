import { requireSession, HttpError } from "./privy-server";
import { findMember, readOrg, type Institution, type Member } from "./org";

export async function requireDesk(req: Request): Promise<{ userId: string; accessToken: string; institution: Institution; member: Member }> {
  const s = await requireSession(req);
  const hit = findMember(readOrg(), s.userId);
  if (!hit) throw new HttpError(403, "your user is not attached to an institution");
  return { ...s, ...hit };
}

export function requireRole(member: Member, roles: Member["role"][], what: string) {
  if (!roles.includes(member.role)) throw new HttpError(403, `${what} requires one of: ${roles.join(", ")}`);
}
