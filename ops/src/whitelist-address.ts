/** Add an address (e.g. a new SettlementEngine) to the tranche's control list.  npx tsx src/whitelist-address.ts --evm 0x... */
import { connectAts, sdk } from "./lib/ats.js";
import { readDeployments } from "./lib/deployments.js";
const evm = process.argv[process.argv.indexOf("--evm") + 1];
if (!evm?.startsWith("0x")) throw new Error("--evm required");
const token = readDeployments().loanToken!.evmAddress as string;
await connectAts();
const { Security, ControlListRequest } = sdk;
const already = await Security.isAccountInControlList(new ControlListRequest({ securityId: token, targetId: evm }));
if (already) { console.log(`${evm} already whitelisted`); process.exit(0); }
const r = await Security.addToControlList(new ControlListRequest({ securityId: token, targetId: evm }));
console.log(`whitelisted ${evm}: ${JSON.stringify(r)}`);
