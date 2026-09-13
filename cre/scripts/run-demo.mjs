/**
 * Run the confidential-workflow simulation for every asset on the loan register and persist only
 * sanitised evidence for the UI: per-asset released distributions plus one tamper run.
 *
 *   node cre/scripts/run-demo.mjs               every asset (prepared + browser-issued)
 *   node cre/scripts/run-demo.mjs MH-RCF        one asset
 *   node cre/scripts/run-demo.mjs --no-tamper   skip the negative test
 *
 * Needs the web dev server on :3000 (private notice endpoint) and the CRE CLI. An asset without a
 * committed rate notice gets one published first (its rate from the deployment record, default 725 bps).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const creRoot = path.resolve(here, "..");
const repoRoot = path.resolve(creRoot, "..");
config({ path: path.join(creRoot, ".env") });
const args = process.argv.slice(2);
const noTamper = args.includes("--no-tamper");
const wanted = args.filter((a) => !a.startsWith("--"));

const workflowDir = path.join(creRoot, "interest-accrual");
const configPath = path.join(workflowDir, "config.staging.json");
const tamperPath = path.join(workflowDir, "config.tamper.json");
const baseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
const evidenceDir = path.join(creRoot, "evidence");
fs.mkdirSync(path.join(evidenceDir, "distributions"), { recursive: true });

/** Assets on the register: the ops deployment record plus completed browser issuances (local store). */
function registerAssets() {
  const dep = JSON.parse(fs.readFileSync(path.join(repoRoot, "ops/deployments/testnet.json"), "utf8"));
  const out = [{ symbol: dep.loanToken.symbol, evmAddress: dep.loanToken.evmAddress, rateBps: dep.loanToken.rateBps ?? 725 }];
  for (const a of dep.assets ?? []) out.push({ symbol: a.symbol, evmAddress: a.evmAddress, rateBps: a.rateBps ?? 725 });
  const local = path.join(repoRoot, "web/data/hosted-workflows.json");
  if (fs.existsSync(local)) {
    try {
      const values = JSON.parse(fs.readFileSync(local, "utf8")).values ?? {};
      const state = JSON.parse(values["issuance-state"] ?? "{}");
      for (const r of state.records ?? []) if (r.completedAt && r.securityAddress) out.push({ symbol: r.terms.symbol, evmAddress: r.securityAddress, rateBps: r.terms.rateBps ?? 725 });
    } catch { /* no browser issuances recorded locally */ }
  }
  return out;
}

function hasNotice(symbol) {
  const file = path.join(repoRoot, "web/data/notices.json");
  if (!fs.existsSync(file)) return false;
  return (JSON.parse(fs.readFileSync(file, "utf8")).notices ?? []).some((n) => n.facilityId === symbol);
}

function publishNotice(asset) {
  console.log(`\n[CRE] publishing a rate-notice commitment for ${asset.symbol}`);
  const run = spawnSync("npx", ["tsx", "scripts/publish-notice.mts", "--facility", asset.symbol, "--rate", String(asset.rateBps), "--days", "30"], { cwd: path.join(repoRoot, "web"), env: process.env, encoding: "utf8" });
  process.stdout.write(run.stdout ?? "");
  if (run.status !== 0) { process.stderr.write(run.stderr ?? ""); throw new Error(`could not publish a notice for ${asset.symbol}`); }
}

function simulate(target) {
  const cfg = JSON.parse(fs.readFileSync(target === "tamper-settings" ? tamperPath : configPath, "utf8"));
  console.log(`\n[CRE] simulating ${target} (${cfg.facilityId}${cfg.tamper ? ", TAMPERED notice" : ""})`);
  const run = spawnSync("cre", ["workflow", "simulate", "interest-accrual", "--target", target, "--non-interactive", "--trigger-index", "0"], { cwd: creRoot, env: process.env, encoding: "utf8" });
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
  try { return JSON.parse(JSON.parse(m[1])); } catch { return null; }
}

const writeConfig = (file, asset, tamper) => fs.writeFileSync(file, `${JSON.stringify({ ...baseConfig, facilityId: asset.symbol, loanToken: asset.evmAddress, tamper }, null, 2)}\n`);

const assets = registerAssets().filter((a) => wanted.length === 0 || wanted.some((w) => w.toUpperCase() === a.symbol));
if (!assets.length) throw new Error(`no matching asset on the register (${registerAssets().map((a) => a.symbol).join(", ")})`);
const primary = assets[0];
const previous = JSON.parse(fs.existsSync(path.join(evidenceDir, "latest.json")) ? fs.readFileSync(path.join(evidenceDir, "latest.json"), "utf8") : "{}");
const now = Date.now();
const perAsset = previous.assets ?? {};
try {
  for (const asset of assets) {
    if (!hasNotice(asset.symbol)) publishNotice(asset);
    writeConfig(configPath, asset, false);
    const valid = simulate("staging-settings");
    if (valid.code !== 0) throw new Error(`Valid-notice simulation failed for ${asset.symbol}; no success evidence was recorded.`);
    const released = releasedOutput(valid.output);
    if (!released?.distribution || released.facilityId !== asset.symbol) throw new Error(`Simulation for ${asset.symbol} completed but its released distribution could not be parsed.`);
    const record = { ranAt: now, ...released };
    fs.writeFileSync(path.join(evidenceDir, "distributions", `${asset.symbol}.json`), `${JSON.stringify(record, null, 2)}\n`);
    if (asset.symbol === baseConfig.facilityId) fs.writeFileSync(path.join(evidenceDir, "distribution.json"), `${JSON.stringify(record, null, 2)}\n`);
    perAsset[asset.symbol] = { ranAt: now, status: "verified", periodId: released.periodId, holders: released.distribution.length, totalUnits: released.totalUnits };
    console.log(`[CRE] ${asset.symbol}: period ${released.periodId}, ${released.distribution.length} holders, ${released.totalUnits} mUSD units released`);
  }
  let tamper = previous.tamper;
  if (!noTamper) {
    writeConfig(tamperPath, primary, true);
    console.log(`\n[CRE] ==== NEGATIVE TEST: TAMPERED RATE NOTICE (${primary.symbol}) ====`);
    console.log("[CRE] The agent endpoint now serves a deliberately altered notice (rate +25 bps) for the same commitment.");
    console.log("[CRE] The enclave MUST refuse it. A '✗ workflow execution failed: ... TAMPERED ... accrual aborted' line below is the PASS result.");
    console.log("[CRE] (The simulator's CRE_ETH_PRIVATE_KEY note is informational: this workflow never writes to a chain.)");
    const run = simulate("tamper-settings");
    if (run.code === 0 || !/does not match the committed hash|commitment mismatch|accrual aborted/i.test(run.output)) throw new Error("Tamper simulation did not fail for the expected commitment-mismatch reason.");
    console.log(`[CRE] ==== NEGATIVE TEST PASSED: the tampered notice was rejected and nothing was released ====\n`);
    tamper = { ranAt: now, status: "rejected", summary: "Negative test: a deliberately tampered rate notice (rate +25 bps) was rejected inside the enclave; nothing was released." };
  }
  const first = perAsset[primary.symbol];
  const evidence = {
    valid: { ranAt: first.ranAt, status: "verified", facilityId: primary.symbol, summary: `Commitment matched; accrual report generated for ${first.holders} holders (${primary.symbol}).`, periodId: first.periodId, holders: first.holders, totalUnits: first.totalUnits },
    tamper,
    assets: perAsset,
  };
  fs.writeFileSync(path.join(evidenceDir, "latest.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n[CRE] evidence captured for ${assets.map((a) => a.symbol).join(", ")} in cre/evidence/`);
} finally {
  // Leave the committed configs pointing at the first tranche.
  writeConfig(configPath, { symbol: baseConfig.facilityId, evmAddress: baseConfig.loanToken }, false);
  writeConfig(tamperPath, { symbol: baseConfig.facilityId, evmAddress: baseConfig.loanToken }, true);
}
