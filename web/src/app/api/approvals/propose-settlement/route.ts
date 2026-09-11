import { Interface } from "ethers";
import { requireSession, jsonError, HttpError } from "@/lib/privy-server";
import { findMember, readOrg } from "@/lib/org";
import { proposeSignTransaction } from "@/lib/approvals";
import { venue } from "@/lib/venue";

const engine = new Interface(["function approve(uint256 tradeId, bytes32 instructionHash)"]);

/** Propose that the desk wallet approves a settlement instruction on the SettlementEngine. */
export async function POST(req: Request) {
  try {
    const s = await requireSession(req);
    const hit = findMember(readOrg(), s.userId);
    if (!hit) throw new HttpError(403, "not a desk member");
    if (hit.member.role !== "trader" && hit.member.role !== "pm") throw new HttpError(403, "only traders or portfolio managers propose");
    if (!hit.institution.wallet) throw new HttpError(409, "no desk wallet");
    const { tradeId, instructionHash } = await req.json();
    if (!/^0x[0-9a-fA-F]{64}$/.test(instructionHash)) throw new HttpError(400, "instructionHash must be a 32-byte hex string");
    const data = engine.encodeFunctionData("approve", [BigInt(tradeId), instructionHash]);
    const intent = await proposeSignTransaction({
      walletId: hit.institution.wallet.id,
      walletAddress: hit.institution.wallet.address,
      to: venue().settlementEngine,
      data,
      summary: `Approve settlement instruction #${tradeId}`,
    });
    return Response.json({ intent });
  } catch (e) {
    return jsonError(e);
  }
}
