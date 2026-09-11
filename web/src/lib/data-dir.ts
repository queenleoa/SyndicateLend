import path from "node:path";

/**
 * Where the demo's JSON files live. Locally `web/data/` (gitignored). On Vercel the project directory is
 * read-only, so writes go to /tmp, which is ephemeral: institutions must be re-provisioned per deployment.
 * Override with DATA_DIR.
 */
export function dataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.VERCEL) return "/tmp/syndicatelend-data";
  return path.resolve(process.cwd(), "data");
}
