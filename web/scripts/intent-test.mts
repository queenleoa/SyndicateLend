/** Create a desk intent (eth_signTransaction of SettlementEngine.approve) and print it. */
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url).pathname });
import { Interface, keccak256, toUtf8Bytes } from "ethers";
const { readOrg } = await import("../src/lib/org");
const { proposeSignTransaction, getIntent, listWalletIntents } = await import("../src/lib/approvals");
const { venue } = await import("../src/lib/venue");
const inst = readOrg().institutions.find((i) => i.id === (process.argv[2] ?? "meridian"))!;
const engine = new Interface(["function approve(uint256 tradeId, bytes32 instructionHash)"]);
const data = engine.encodeFunctionData("approve", [1n, keccak256(toUtf8Bytes("demo"))]);
const intent = await proposeSignTransaction({ walletId: inst.wallet!.id, to: venue().settlementEngine, data, summary: "test" });
console.log(JSON.stringify(intent, null, 2));
const again = await getIntent(intent.intent_id);
console.log("status:", again.status, "expires:", new Date(again.expires_at).toISOString());
const list = await listWalletIntents(inst.wallet!.id);
console.log("intents for wallet:", list.length);
