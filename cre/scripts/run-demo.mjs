/** Run the valid and tampered confidential-workflow simulations and persist only sanitized evidence for the UI. */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const creRoot = path.resolve(here, "..");
config({ path: path.join(creRoot, ".env") });

function simulate(target) {
  console.log(`\n[CRE] simulating ${target}`);
  const run = spawnSync("cre", ["workflow", "simulate", "interest-accrual", "--target", target, "--non-interactive", "--trigger-index", "0"], {
    cwd: creRoot,
    env: process.env,
    encoding: "utf8",
  });
  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  if (run.error?.code === "ENOENT") throw new Error("CRE CLI not found. Install it before running the evidence capture.");
  return { code: run.status ?? 1, output: `${run.stdout ?? ""}\n${run.stderr ?? ""}` };
}

const valid = simulate("staging-settings");
if (valid.code !== 0) throw new Error("Valid-notice simulation failed; no success evidence was recorded.");
const tamper = simulate("tamper-settings");
if (tamper.code === 0 || !/does not match the committed hash|commitment mismatch|accrual aborted/i.test(tamper.output)) {
  throw new Error("Tamper simulation did not fail for the expected commitment-mismatch reason.");
}

const now = Date.now();
const evidence = {
  valid: { ranAt: now, status: "verified", summary: "Commitment matched; holder accrual report generated." },
  tamper: { ranAt: now, status: "rejected", summary: "Altered private notice rejected before any output crossed the TEE boundary." },
};
const evidenceDir = path.join(creRoot, "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, "latest.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log("\n[CRE] positive and negative evidence captured in cre/evidence/latest.json");
