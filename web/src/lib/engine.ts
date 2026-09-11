import { createRequire } from "node:module";
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes, type InterfaceAbi } from "ethers";
import { venue } from "./venue";
import { HEDERA_RPC } from "./hedera";

const require = createRequire(import.meta.url);
const artifact = require("../../../contracts/out/SettlementEngine.sol/SettlementEngine.json");
export const ENGINE_ABI = artifact.abi as InterfaceAbi;

export const STATE = ["None", "AwaitingApprovals", "Scheduled", "Settled", "Failed", "Cancelled"] as const;
export type EngineState = (typeof STATE)[number];

function provider() {
  return new JsonRpcProvider(HEDERA_RPC, undefined, { staticNetwork: true });
}

/** Venue (administrative agent) signer: creates settlement instructions from accepted RFQs. */
export function venueEngine() {
  const wallet = new Wallet(process.env.OPERATOR_PRIVATE_KEY!, provider());
  return new Contract(venue().settlementEngine, ENGINE_ABI, wallet);
}
export function readEngine() {
  return new Contract(venue().settlementEngine, ENGINE_ABI, provider());
}

export interface InstructionInput {
  buyer: string;
  seller: string;
  par: bigint;
  cash: bigint;
  settleAt: number;
  expiresAt: number;
  rfqRef: string; // bytes32
}

export function rfqRef(rfqId: string, quoteId: string) {
  return keccak256(toUtf8Bytes(`${rfqId}/${quoteId}`));
}

export async function createInstruction(i: InstructionInput) {
  const v = venue();
  const engine = venueEngine();
  const tx = await engine.createTrade(
    { loanToken: v.loanToken, cashToken: v.mockUsd, buyer: i.buyer, seller: i.seller, par: i.par, cash: i.cash, settleAt: i.settleAt, expiresAt: i.expiresAt, rfqRef: i.rfqRef },
    { gasLimit: 1_000_000 },
  );
  const rcpt = await tx.wait();
  const ev = rcpt.logs
    .map((l: { topics: readonly string[]; data: string }) => {
      try {
        return engine.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e: { name: string } | null) => e?.name === "TradeCreated");
  if (!ev) throw new Error("TradeCreated event not found");
  return { tradeId: ev.args.tradeId.toString() as string, instructionHash: ev.args.instructionHash as string, txHash: tx.hash as string };
}

export async function getTrade(tradeId: string) {
  const t = await readEngine().getTrade(tradeId);
  return {
    loanToken: t.loanToken as string,
    cashToken: t.cashToken as string,
    buyer: t.buyer as string,
    seller: t.seller as string,
    par: (t.par as bigint).toString(),
    cash: (t.cash as bigint).toString(),
    settleAt: Number(t.settleAt),
    expiresAt: Number(t.expiresAt),
    rfqRef: t.rfqRef as string,
    state: STATE[Number(t.state)] as EngineState,
    buyerApproved: t.buyerApproved as boolean,
    sellerApproved: t.sellerApproved as boolean,
    scheduleAddress: t.scheduleAddress as string,
    failureReason: t.failureReason as string,
  };
}

/** Calldata for a desk wallet's approval of an instruction (signed via the desk's Privy quorum). */
export function approveCalldata(tradeId: string, instructionHash: string) {
  return readEngine().interface.encodeFunctionData("approve", [BigInt(tradeId), instructionHash]);
}
