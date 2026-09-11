import { encodeAbiParameters, keccak256, parseAbiParameters, type Hex } from "viem";
import { randomBytes } from "node:crypto";
import { jsonStore } from "./store";
import { publish, noticeTopicId } from "./hcs";
import { readOrg } from "./org";

/**
 * Administrative-agent rate notices. The notice itself (rate, day count, period) is private and
 * served only to the confidential workflow over an authenticated endpoint. What goes to the
 * public HCS topic is a commitment: keccak256 over the notice fields plus a random 32-byte
 * nonce, so the committed value cannot be brute-forced from plausible rates.
 */
export interface Notice {
  facilityId: string;
  periodId: number;
  periodStart: number; // unix seconds
  periodEnd: number;
  rateBps: number; // all-in rate, basis points (e.g. 725 = 7.25%)
  dayCountBasis: number; // 360 or 365
  holders: string[]; // desk wallets in the register snapshot (public)
  nonce: Hex; // 32 bytes, private
  commitment: Hex; // published
  createdAt: number;
  hcs?: { sequence: number; transactionId: string };
}

export const NOTICE_ABI = parseAbiParameters("string facilityId, uint256 periodId, uint256 periodStart, uint256 periodEnd, uint256 rateBps, uint256 dayCountBasis, bytes32 nonce");

export function commitmentOf(n: Pick<Notice, "facilityId" | "periodId" | "periodStart" | "periodEnd" | "rateBps" | "dayCountBasis" | "nonce">): Hex {
  return keccak256(encodeAbiParameters(NOTICE_ABI, [n.facilityId, BigInt(n.periodId), BigInt(n.periodStart), BigInt(n.periodEnd), BigInt(n.rateBps), BigInt(n.dayCountBasis), n.nonce]));
}

export const notices = jsonStore<{ notices: Notice[] }>("notices", { notices: [] });

export function findNotice(facilityId: string, periodId: number) {
  return notices.read().notices.find((n) => n.facilityId === facilityId && n.periodId === periodId) ?? null;
}

/** Create a notice, commit to it on HCS, keep the plaintext private. */
export async function createAndCommit(input: { facilityId: string; periodStart: number; periodEnd: number; rateBps: number; dayCountBasis?: number }) {
  const existing = notices.read().notices.filter((n) => n.facilityId === input.facilityId);
  const periodId = existing.length ? Math.max(...existing.map((n) => n.periodId)) + 1 : 1;
  const holders = readOrg().institutions.filter((i) => i.wallet).map((i) => i.wallet!.address.toLowerCase());
  const nonce = ("0x" + randomBytes(32).toString("hex")) as Hex;
  const base = { facilityId: input.facilityId, periodId, periodStart: input.periodStart, periodEnd: input.periodEnd, rateBps: input.rateBps, dayCountBasis: input.dayCountBasis ?? 360, nonce };
  const commitment = commitmentOf(base);
  const r = await publish(
    { type: "notice-commitment", facilityId: input.facilityId, periodId, periodStart: input.periodStart, periodEnd: input.periodEnd, holders, commitment } as never,
    noticeTopicId(),
  );
  const notice: Notice = { ...base, holders, commitment, createdAt: Date.now(), hcs: { sequence: r.sequence, transactionId: r.transactionId } };
  notices.write((s) => s.notices.push(notice));
  return notice;
}
