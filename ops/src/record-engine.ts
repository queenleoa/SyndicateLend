/** Record the deployed SettlementEngine address.  npx tsx src/record-engine.ts --address 0x... [--tx <hash>] */
import { writeDeployments } from "./lib/deployments.js";
const address = process.argv[process.argv.indexOf("--address") + 1];
if (!address?.startsWith("0x")) throw new Error("--address 0x... required");
const txi = process.argv.indexOf("--tx");
writeDeployments((d) => (d.settlementEngine = { address, deployTx: txi > -1 ? process.argv[txi + 1] : undefined }));
console.log(`recorded settlementEngine ${address}`);
