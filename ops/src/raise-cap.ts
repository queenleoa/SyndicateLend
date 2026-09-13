/**
 * Upsize the tranche: raise the ATS security's maximum supply so the agent can allocate opening
 * positions to newly onboarded desks (the original 250,000,000 units are fully issued).
 *   npm run raise-cap -- --max 1000000000
 */
import { Contract } from "ethers";
import { HASHSCAN } from "./lib/env.js";
import { connectAts, sdk } from "./lib/ats.js";
import { operatorWallet } from "./lib/diamond.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";

const max = BigInt(process.argv[process.argv.indexOf("--max") + 1] ?? "1000000000");
const dep = readDeployments();
const token = dep.loanToken!.evmAddress as string;
const { wallet } = await connectAts();
const { Role, RoleRequest } = sdk;
const CAP_ROLE = "0x58d502b7184e1a264e0cacf1a19a6c268356c6d9fda5ad83ab3b599cd3b7f41c"; // keccak256("CAP_ROLE") per the ATS SDK
await Role.grantRole(new RoleRequest({ securityId: token, targetId: wallet.address, role: CAP_ROLE }));
console.log(`CAP role granted to the agent ${wallet.address}`);
const cap = new Contract(token, ["function setMaxSupply(uint256 maxSupply)", "function getMaxSupply() view returns (uint256)", "function totalSupply() view returns (uint256)"], operatorWallet());
const tx = await cap.setMaxSupply(max, { gasLimit: 1_000_000 });
const rc = await tx.wait();
console.log(`max supply set to ${max}: status=${rc?.status} ${HASHSCAN}/transaction/${tx.hash}`);
console.log(`max supply ${await cap.getMaxSupply()} / total supply ${await cap.totalSupply()}`);
writeDeployments((d) => { (d.loanToken as Record<string, unknown>).maxSupply = max.toString(); (d.loanToken as Record<string, unknown>).raiseCapTx = tx.hash; });
process.exit(0);
