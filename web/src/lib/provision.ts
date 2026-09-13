
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
    display_name: `${input.name} desk quorum (2 of 3)`.slice(0, 50),
    user_ids: members.map((m) => m.privyUserId!),
    authorization_threshold: 2,
  });

  // 3. policy: settlement venue only, on Hedera testnet; owned by the quorum so changing it
  //    also needs two approvals. Created before the wallet so it can be attached at creation.
  const policy = await createVenuePolicy(input.name, quorum.id);

  // 4. wallet owned by the quorum, governed by the policy: no single person can move it
  const wallet = await p.wallets().create({
    chain_type: "ethereum",
    display_name: `${input.name} desk wallet`.slice(0, 50),
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

/**
 * Self-service judge desk: a 2-of-3 quorum of the signed-in trader, the venue's automated compliance
 * co-signer (a server-held P-256 key) and a reserve key minted for this desk (public half only). The
 * judge signs once in the browser; the venue adds the co-signature after checking the intent, and Privy
 * executes under the same venue-only policy. The venue holds one key of three, so it cannot execute alone.
 * Named institutions keep their 2-of-3 human quorums.
 */
export async function provisionSelfServiceInstitution(input: { id: string; name: string; email: string; userId: string; cosignerPublicKey: string; reserveSignerPublicKey: string }) {
  const p = privy();
  await p.users().setCustomMetadata(input.userId, { custom_metadata: { institution: input.id, role: "trader" } }).catch(() => undefined);
  const quorum = await p.keyQuorums().create({
    display_name: `${input.name} quorum (2 of 3)`.slice(0, 50),
    user_ids: [input.userId],
    public_keys: [input.cosignerPublicKey, input.reserveSignerPublicKey],
    authorization_threshold: 2,
  });
  const policy = await createVenuePolicy(input.name, quorum.id);
  const wallet = await p.wallets().create({ chain_type: "ethereum", display_name: `${input.name} desk wallet`.slice(0, 50), owner_id: quorum.id, policy_ids: [policy.id] });
  const institution: Institution = {
    id: input.id, name: input.name,
    members: [{ email: input.email, role: "trader", privyUserId: input.userId }],
    keyQuorumId: quorum.id, wallet: { id: wallet.id, address: wallet.address }, policyId: policy.id,
    selfService: true, cosigner: "automated", reserveSigner: { publicKey: input.reserveSignerPublicKey }, createdAt: Date.now(),
  };
  writeOrg((o) => {
    o.institutions = o.institutions.filter((i) => i.id !== input.id);
    o.institutions.push(institution);
  });
  return institution;
}

/** Wallet policy: the desk may only call the settlement venue contracts on Hedera testnet, never export its key. */
export async function createVenuePolicy(name: string, ownerId: string) {
  const v = venue();
  const engineAbi = [
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "tradeId", type: "uint256" }, { name: "instructionHash", type: "bytes32" }], outputs: [] },
    { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "tradeId", type: "uint256" }], outputs: [] },
    { type: "function", name: "reissue", stateMutability: "nonpayable", inputs: [{ name: "tradeId", type: "uint256" }, { name: "newSettleAt", type: "uint64" }, { name: "newExpiresAt", type: "uint64" }], outputs: [] },
  ] as const;
  const erc20Abi = [
    { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  ] as const;
  // HIP-719: an HTS token exposes associate() at its own address; the desk must associate before
  // it can be KYC'd and receive mock USD.
  const hrc719Abi = [{ type: "function", name: "associate", stateMutability: "nonpayable", inputs: [], outputs: [{ name: "", type: "uint256" }] }] as const;
  // Privy evaluates DENY before ALLOW and denies anything no rule allows, so there is no
  // catch-all deny rule: only the two allow rules below (and an explicit export ban) exist.
  return privy().policies().create({
    version: "1.0",
    chain_type: "ethereum",
    name: `${name}: settlement venue only`.slice(0, 50),
    owner_id: ownerId,
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
      {
        name: "Mock USD: associate the desk account (HIP-719)",
        method: "eth_signTransaction",
        action: "ALLOW",
        conditions: [
          { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value: String(v.chainId) },
          { field_source: "ethereum_transaction", field: "to", operator: "eq", value: v.mockUsd.toLowerCase() },
          { field_source: "ethereum_transaction", field: "value", operator: "eq", value: "0" },
          { field_source: "ethereum_calldata", field: "function_name", abi: hrc719Abi, operator: "eq", value: "associate" },
        ],
      },
      { name: "Never export the desk key", method: "exportPrivateKey", action: "DENY", conditions: [] },
    ],
  });

}

/**
 * Automated liquidity desk: a quorum of two server-held P-256 keys (threshold 2) instead of people.
 * The venue signs its intents with both keys, so this desk can quote, accept and approve unattended.
 * `publicKeys` are the SPKI DER base64 forms of AUTOMATED_DESK_KEYS.
 */
export async function provisionAutomatedDesk(input: { id: string; name: string; publicKeys: string[]; registryDemoKeyFingerprint?: string }) {
  const p = privy();
  const quorum = await p.keyQuorums().create({ display_name: `${input.name} automated quorum`.slice(0, 50), public_keys: input.publicKeys, authorization_threshold: 2 });
  const policy = await createVenuePolicy(input.name, quorum.id);
  const wallet = await p.wallets().create({ chain_type: "ethereum", display_name: `${input.name} desk wallet`.slice(0, 50), owner_id: quorum.id, policy_ids: [policy.id] });
  const institution: Institution = { id: input.id, name: input.name, members: [], keyQuorumId: quorum.id, wallet: { id: wallet.id, address: wallet.address }, policyId: policy.id, automated: true, createdAt: Date.now(), ...(input.registryDemoKeyFingerprint ? { registryDemo: { keyFingerprint: input.registryDemoKeyFingerprint } } : {}) };
  writeOrg((o) => {
    o.institutions = o.institutions.filter((i) => i.id !== input.id);
    o.institutions.push(institution);
  });
  return institution;
}

export function listInstitutions(): Institution[] {
  return readOrg().institutions;
}
