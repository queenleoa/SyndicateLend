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

/**
 * The simulator prints the handler's return value after "Workflow Simulation Result:" as a JSON-encoded
 * string. That value is the workflow's *released* output (commitment, period, holders, amounts): it is what
 * the DON report carries and what the paying agent needs. It contains no rate, basis or nonce.
 */
function releasedOutput(output) {
  const m = output.match(/Workflow Simulation Result:\s*\n\s*("(?:[^"\\]|\\.)*")/);
  if (!m) return null;
  try {
    return JSON.parse(JSON.parse(m[1]));
  } catch {
    return null;
  }
}

const valid = simulate("staging-settings");
if (valid.code !== 0) throw new Error("Valid-notice simulation failed; no success evidence was recorded.");
const released = releasedOutput(valid.output);
if (!released?.distribution) throw new Error("Valid simulation completed but its released distribution could not be parsed.");
const tamper = simulate("tamper-settings");
if (tamper.code === 0 || !/does not match the committed hash|commitment mismatch|accrual aborted/i.test(tamper.output)) {
  throw new Error("Tamper simulation did not fail for the expected commitment-mismatch reason.");
}

const now = Date.now();
const evidence = {
  valid: {
    ranAt: now,
    status: "verified",
    summary: `Commitment matched; accrual report generated for ${released.distribution.length} holders over ${released.days} days.`,
    periodId: released.periodId,
    holders: released.distribution.length,
    totalUnits: released.totalUnits,
  },
  tamper: { ranAt: now, status: "rejected", summary: "Altered private notice rejected before any output crossed the TEE boundary." },
};
const evidenceDir = path.join(creRoot, "evidence");
fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(path.join(evidenceDir, "latest.json"), `${JSON.stringify(evidence, null, 2)}\n`);
// The released distribution drives the mock-USD payout (`npm run pay-interest` in ops/).
fs.writeFileSync(path.join(evidenceDir, "distribution.json"), `${JSON.stringify({ ranAt: now, ...released }, null, 2)}\n`);
console.log(`\n[CRE] positive and negative evidence captured in cre/evidence/latest.json; released distribution in cre/evidence/distribution.json`);
