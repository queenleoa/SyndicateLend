/** Platform administrators act as the arranger / administrative agent in the registry. An empty allow-list means everyone (local demo). */
export function isPlatformAdmin(userId: string): boolean {
  const allowed = (process.env.PLATFORM_ADMIN_PRIVY_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(userId);
}

/** Stable, distinct colour per institution for the register and assignment views. */
export const PALETTE = ["#2b4f80", "#4aa9d8", "#1f7a4d", "#c2410c", "#6554a4", "#0f766e", "#be185d", "#9a6700", "#7c3aed", "#0e7490", "#365314", "#b3261e"];
export function colourFor(index: number) {
  return PALETTE[index % PALETTE.length];
}
