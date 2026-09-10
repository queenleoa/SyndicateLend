import { AccountId, Client, PrivateKey } from "@hashgraph/sdk";
import { NETWORK, requireEnv } from "./env.js";

export function operatorKey(): PrivateKey {
  return PrivateKey.fromStringECDSA(requireEnv("OPERATOR_PRIVATE_KEY"));
}

export function operatorId(): AccountId {
  return AccountId.fromString(requireEnv("OPERATOR_ACCOUNT_ID"));
}

export function hederaClient(): Client {
  const client = NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(operatorId(), operatorKey());
  return client;
}
