/**
 * Create the HCS topics that carry the RFQ audit trail and the confidential-notice commitments.
 *   npx tsx src/create-topics.ts
 */
import { TopicCreateTransaction } from "@hashgraph/sdk";
import { hederaClient, operatorKey } from "./lib/client.js";
import { HASHSCAN } from "./lib/env.js";
import { readDeployments, writeDeployments } from "./lib/deployments.js";

const client = hederaClient();
const key = operatorKey();
const topics = readDeployments().topics ?? {};

async function create(memo: string, restrictedSubmit: boolean) {
  let tx = new TopicCreateTransaction().setTopicMemo(memo).setAdminKey(key.publicKey);
  if (restrictedSubmit) tx = tx.setSubmitKey(key.publicKey);
  const resp = await tx.execute(client);
  const rcpt = await resp.getReceipt(client);
  return rcpt.topicId!.toString();
}

if (!topics.rfq) {
  // Open submit: any desk can publish RFQ events (payloads are synthetic on public testnet).
  topics.rfq = await create("SyndicateLend RFQ events (testnet demo)", false);
  console.log(`RFQ topic: ${topics.rfq}  ${HASHSCAN}/topic/${topics.rfq}`);
}
if (!topics.notices) {
  // Restricted submit: only the administrative agent commits interest-notice hashes.
  topics.notices = await create("SyndicateLend agent notice commitments (hash only)", true);
  console.log(`Notice topic: ${topics.notices}  ${HASHSCAN}/topic/${topics.notices}`);
}
writeDeployments((d) => (d.topics = topics));
client.close();
