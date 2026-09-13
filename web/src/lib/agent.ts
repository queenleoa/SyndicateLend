export function platformAdminAllowed(userId: string, allowList: string | undefined, hosted: boolean): boolean {
  const allowed = (allowList ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.length ? allowed.includes(userId) : !hosted;
}

/** Hosted deployments require explicit agent identities. Judge demo consent has its own reserved scope. */
export function isPlatformAdmin(userId: string): boolean {
  return platformAdminAllowed(userId, process.env.PLATFORM_ADMIN_PRIVY_USER_IDS, Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production");
}

/** Stable, distinct colour per institution for the register and assignment views. */
export const PALETTE = ["#2b4f80", "#4aa9d8", "#1f7a4d", "#c2410c", "#6554a4", "#0f766e", "#be185d", "#9a6700", "#7c3aed", "#0e7490", "#365314", "#b3261e"];
export function colourFor(index: number) {
  return PALETTE[index % PALETTE.length];
}
