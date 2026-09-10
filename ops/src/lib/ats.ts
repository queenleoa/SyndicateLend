/**
 * Bootstraps the Asset Tokenization Studio SDK for a Node.js process.
 *
 * The SDK ships wallet adapters for MetaMask, WalletConnect and custodians only. Its own test
 * suite drives it from Node by running the MetaMask adapter in debug mode (no browser probing)
 * and injecting an ethers Wallet as the signer. We do the same here. Everything is loaded through
 * the SDK's CommonJS build via createRequire so the DI container instance is shared with the
 * internal classes we need to reach (Injectable, RPCTransactionAdapter), which are not re-exported.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { JsonRpcProvider, Wallet } from "ethers";
import { MIRROR_URL, NETWORK, RPC_URL, requireEnv } from "./env.js";

const require = createRequire(import.meta.url);
const sdkIndex = require.resolve("@hashgraph/asset-tokenization-sdk"); // .../build/cjs/src/index.js
const cjsSrc = path.dirname(sdkIndex);

// Public API (CJS build).
export const sdk: typeof import("@hashgraph/asset-tokenization-sdk") = require(sdkIndex);
// Internal classes (same module graph as `sdk`).
const Injectable = require(path.join(cjsSrc, "core/injectable/Injectable.js")).default;
const { RPCTransactionAdapter } = require(path.join(cjsSrc, "port/out/rpc/RPCTransactionAdapter.js"));
// Request classes used by Network.setNetwork / setConfig are not re-exported from the index.
const SetNetworkRequest = require(path.join(cjsSrc, "port/in/request/network/SetNetworkRequest.js")).default;
const SetConfigurationRequest = require(path.join(cjsSrc, "port/in/request/management/SetConfigurationRequest.js")).default;

/** ATS 8.0.0-compatible testnet deployment (2026-06-12). Older deployments use different role hashes. */
export const ATS_TESTNET = {
  resolverAddress: process.env.ATS_RESOLVER ?? "0.0.9212226",
  factoryAddress: process.env.ATS_FACTORY ?? "0.0.9213391",
  bondConfigId: "0x0000000000000000000000000000000000000000000000000000000000000002",
  equityConfigId: "0x0000000000000000000000000000000000000000000000000000000000000001",
  configVersion: 1,
};

const mirrorNode = { name: "mirror", baseUrl: `${MIRROR_URL}/api/v1/`, apiKey: "", headerName: "" };
const rpcNode = { name: "rpc", baseUrl: RPC_URL, apiKey: "", headerName: "" };

let connected: { wallet: Wallet; accountId: string } | null = null;

export async function connectAts(opts?: { privateKey?: string; accountId?: string }) {
  if (connected) return connected;
  const privateKey = opts?.privateKey ?? requireEnv("OPERATOR_PRIVATE_KEY");
  const accountId = opts?.accountId ?? requireEnv("OPERATOR_ACCOUNT_ID");
  const { Network, ConnectRequest, SupportedWallets } = sdk;

  await Network.setNetwork(new SetNetworkRequest({ environment: NETWORK as any, mirrorNode, rpcNode }));
  await Network.setConfig(
    new SetConfigurationRequest({ factoryAddress: ATS_TESTNET.factoryAddress, resolverAddress: ATS_TESTNET.resolverAddress }),
  );

  // TransactionService.getHandlerClass only allows the MetaMask adapter when `global.window` is
  // truthy; MetamaskService then finds no `window.ethereum` and skips browser event wiring.
  const g = globalThis as any;
  if (!g.window) g.window = {};

  const wallet = new Wallet(privateKey, new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true }));
  const th = Injectable.resolve(RPCTransactionAdapter);
  await th.init(true);
  th.setSignerOrProvider(wallet);

  await Network.connect(
    new ConnectRequest({
      account: { accountId, privateKey: { key: privateKey.replace(/^0x/, ""), type: "ECDSA" } },
      network: NETWORK as any,
      mirrorNode,
      rpcNode,
      wallet: SupportedWallets.METAMASK,
      debug: true,
    }),
  );
  connected = { wallet, accountId };
  return connected;
}
