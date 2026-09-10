
import { privy } from "./privy-server";
import { readOrg, writeOrg, type Institution, type Member, type Role } from "./org";
import { venue } from "./venue";

/**
 * Provision one institution in Privy:
 *   1. a Privy user per desk member (email login), tagged with institution + role
 *   2. a key quorum of the three users with threshold 2 (any two of trader / compliance / PM)
 *   3. a policy owned by the quorum that only lets the wallet talk to the settlement venue
 *      contracts on Hedera testnet
 *   4. an organisation wallet owned by that quorum and governed by the policy
 */
export async function provisionInstitution(input: { id: string; name: string; members: { email: string; role: Role }[] }) {
  const p = privy();
  if (input.members.length !== 3) throw new Error("exactly three desk members are required (trader, compliance, pm)");

  // 1. users
  const members: Member[] = [];
  for (const m of input.members) {
    let user;
    try {
      user = await p.users().getByEmailAddress({ address: m.email });
    } catch {
      user = await p.users().create({ linked_accounts: [{ type: "email", address: m.email }] });
    }
    await p.users().setCustomMetadata(user.id, { custom_metadata: { institution: input.id, role: m.role } });
    members.push({ email: m.email, role: m.role, privyUserId: user.id });
  }

  // 2. quorum
  const quorum = await p.keyQuorums().create({
    display_name: `${input.name} desk quorum (2 of 3)`,
    user_ids: members.map((m) => m.privyUserId!),
    authorization_threshold: 2,
  });

  // 3. policy: settlement venue only, on Hedera testnet; owned by the quorum so changing it
  //    also needs two approvals. Created before the wallet so it can be attached at creation
  //    (updating a quorum-owned wallet later would itself require quorum authorisation).
  const v = venue();
  const engineAbi = [
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "tradeId", type: "uint256" }, { name: "instructionHash", type: "bytes32" }], outputs: [] },
    { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "tradeId", type: "uint256" }], outputs: [] },
    { type: "function", name: "reissue", stateMutability: "nonpayable", inputs: [{ name: "tradeId", type: "uint256" }, { name: "newSettleAt", type: "uint64" }, { name: "newExpiresAt", type: "uint64" }], outputs: [] },
  ] as const;
  const erc20Abi = [
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  ] as const;
  // Privy evaluates DENY before ALLOW and denies anything no rule allows, so there is no
  // catch-all deny rule: only the two allow rules below (and an explicit export ban) exist.
  const policy = await p.policies().create({
    version: "1.0",
    chain_type: "ethereum",
    name: `${input.name}: settlement venue only`,
    owner_id: quorum.id,
    rules: [
      {
        name: "Engine: approve, cancel, reissue (Hedera 296)",
        method: "eth_signTransaction",
        action: "ALLOW",
        conditions: [
          { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(v.chainId) },
          { field_source: "ethereum_transaction", field: "to", operator: "eq", value: v.settlementEngine.toLowerCase() },
          { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0" },
          { field_source: "ethereum_calldata", field: "function_name", abi: engineAbi, operator: "in", value: ["approve", "cancel", "reissue"] },
        ],
      },
      {
        name: "Tokens: approve the settlement engine only",
        method: "eth_signTransaction",
        action: "ALLOW",
        conditions: [
          { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(v.chainId) },
          { field_source: "ethereum_transaction", field: "to", operator: "in", value: [v.loanToken.toLowerCase(), v.mockUsd.toLowerCase()] },
          { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0" },
          { field_source: "ethereum_calldata", field: "function_name", abi: erc20Abi, operator: "eq", value: "approve" },
          { field_source: "ethereum_calldata", field: "approve.spender", abi: erc20Abi, operator: "eq", value: v.settlementEngine.toLowerCase() },
        ],
      },
      { name: "Never export the desk key", method: "exportPrivateKey", action: "DENY", conditions: [] },
    ],
  });

  // 4. wallet owned by the quorum, governed by the policy: no single person can move it
  const wallet = await p.wallets().create({
    chain_type: "ethereum",
    display_name: `${input.name} desk wallet`,
    owner_id: quorum.id,
    policy_ids: [policy.id],
  });

  const institution: Institution = {
    id: input.id,
    name: input.name,
    members,
    keyQuorumId: quorum.id,
    wallet: { id: wallet.id, address: wallet.address },
    policyId: policy.id,
  };
  writeOrg((o) => {
    o.institutions = o.institutions.filter((i) => i.id !== input.id);
    o.institutions.push(institution);
  });
  return institution;
}

export function listInstitutions(): Institution[] {
  return readOrg().institutions;
}
