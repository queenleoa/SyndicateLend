import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The app reads the ops deployment record and the CRE evidence files from the repository root at
  // runtime (path.resolve(process.cwd(), "../ops/...")). Trace from the monorepo root and include them
  // so serverless bundles (Vercel) carry those files.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: {
    "/api/**/*": ["../ops/deployments/testnet.json", "../cre/evidence/*.json"],
  },
};

export default nextConfig;
