import { bytesToBase64, cre, hexToBase64, json, ok, type TeeRuntime } from '@chainlink/cre-sdk'
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseAbiParameters, type Hex } from 'viem'
import { z } from 'zod'

// ─── SyndicateLend: confidential interest accrual ───────────────────────────
//
// The administrative agent publishes only a COMMITMENT (keccak256 of the rate notice fields plus
// a random 32-byte nonce) on a public Hedera Consensus Service topic. The notice itself (rate,
// day-count basis, period) is served from a private endpoint that requires a bearer token.
//
// Inside the enclave this handler:
//   1. reads the latest commitment from the public topic (mirror node)
//   2. fetches the private notice with the enclave-held token
//   3. recomputes the commitment and aborts if the notice was altered
//   4. reads each register holder's par balance from the ATS security (mirror node contract call)
//   5. computes the interest due per holder
// and crosses back to the DON with only the distribution: (commitment, periodId, holders, amounts).
// The rate, day count and nonce never leave the enclave. Holders and balances are public register
// data on Hedera anyway; the per-holder amounts are what the paying agent needs to distribute.

export const configSchema = z.object({
	schedule: z.string(),
	facilityId: z.string(),
	mirrorUrl: z.string(),
	noticeTopicId: z.string(),
	loanToken: z.string(),
	snapshotReader: z.string(), // RegisterSnapshot contract: every holder's balance in one call
	noticeUrl: z.string(),
	secretId: z.string(),
	tamper: z.boolean().default(false),
})
type Config = z.infer<typeof configSchema>

// Public commitment message on the notices topic (published by the agent service).
const commitmentSchema = z.object({
	type: z.literal('notice-commitment'),
	facilityId: z.string(),
	periodId: z.number(),
	periodStart: z.number(),
	periodEnd: z.number(),
	holders: z.array(z.string()),
	commitment: z.string().regex(/^0x[0-9a-f]{64}$/i),
})

// Private notice served by the agent endpoint.
const noticeSchema = z.object({
	facilityId: z.string(),
	periodId: z.number(),
	periodStart: z.number(),
	periodEnd: z.number(),
	rateBps: z.number(),
	dayCountBasis: z.number(),
	holders: z.array(z.string()),
	nonce: z.string().regex(/^0x[0-9a-f]{64}$/i),
})

const mirrorMessagesSchema = z.object({
	messages: z.array(
		z.object({
			sequence_number: z.number(),
			consensus_timestamp: z.string(),
			message: z.string(),
			chunk_info: z.object({ initial_transaction_id: z.unknown(), number: z.number(), total: z.number() }).nullable().optional(),
		}),
	),
})
type MirrorMessage = z.infer<typeof mirrorMessagesSchema>['messages'][number]

// HCS splits messages over 1024 bytes into chunks that the mirror node returns as separate messages
// (shared initial_transaction_id, numbered 1..total). Reassemble them into complete texts, newest first.
const completeMessages = (messages: MirrorMessage[]): { seq: number; text: string }[] => {
	const out: { seq: number; text: string }[] = []
	const groups = new Map<string, MirrorMessage[]>()
	for (const m of messages) {
		if (!m.chunk_info || m.chunk_info.total <= 1) {
			out.push({ seq: m.sequence_number, text: base64ToUtf8(m.message) })
			continue
		}
		const key = JSON.stringify(m.chunk_info.initial_transaction_id)
		groups.set(key, [...(groups.get(key) ?? []), m])
	}
	for (const parts of groups.values()) {
		if (parts.length !== parts[0].chunk_info!.total) continue // incomplete in this page
		parts.sort((a, b) => a.chunk_info!.number - b.chunk_info!.number)
		out.push({ seq: parts[parts.length - 1].sequence_number, text: parts.map((x) => base64ToUtf8(x.message)).join('') })
	}
	return out.sort((a, b) => b.seq - a.seq)
}

const mirrorCallSchema = z.object({ result: z.string() })

// Same encoding as the agent service (web/src/lib/notices.ts).
const NOTICE_ABI = parseAbiParameters(
	'string facilityId, uint256 periodId, uint256 periodStart, uint256 periodEnd, uint256 rateBps, uint256 dayCountBasis, bytes32 nonce',
)
const SNAPSHOT_ABI = [
	{
		type: 'function',
		name: 'snapshot',
		stateMutability: 'view',
		inputs: [
			{ name: 'token', type: 'address' },
			{ name: 'holders', type: 'address[]' },
		],
		outputs: [
			{ name: 'out', type: 'uint256[]' },
			{ name: 'total', type: 'uint256' },
		],
	},
] as const

// QuickJS has no atob: decode base64 (mirror node message bodies) by hand.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const base64ToUtf8 = (s: string): string => {
	const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
	const bytes: number[] = []
	for (let i = 0; i < clean.length; i += 4) {
		const n = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0))
		const chunk = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3]
		bytes.push((chunk >> 16) & 255)
		if (i + 2 < clean.length) bytes.push((chunk >> 8) & 255)
		if (i + 3 < clean.length) bytes.push(chunk & 255)
	}
	return new TextDecoder().decode(new Uint8Array(bytes))
}

// Interest for one holder in mock-USD units (6 dp). par is in US$ (1 token = US$1).
// interest = par * rate/10000 * days/basis, computed in integers, rounded down.
const accrual = (par: bigint, rateBps: bigint, days: bigint, basis: bigint): bigint =>
	(par * rateBps * days * 1_000_000n) / (10_000n * basis)

export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config
	const http = new cre.capabilities.HTTPClient()

	// 1. Latest commitment on the public notices topic.
	const topicRes = http
		.sendRequest(runtime, { url: `${config.mirrorUrl}/api/v1/topics/${config.noticeTopicId}/messages?limit=25&order=desc`, method: 'GET' })
		.result()
	if (!ok(topicRes)) throw new Error(`mirror node topic read failed: ${topicRes.statusCode}`)
	// Latest complete notice-commitment (other message types, such as payout receipts, share the topic).
	let commitment: z.infer<typeof commitmentSchema> | null = null
	for (const m of completeMessages(mirrorMessagesSchema.parse(json(topicRes)).messages)) {
		try {
			const parsed = JSON.parse(m.text)
			if (parsed?.type === 'notice-commitment') {
				commitment = commitmentSchema.parse(parsed)
				break
			}
		} catch {
			/* not JSON; skip */
		}
	}
	if (!commitment) throw new Error('no commitment published on the notices topic')
	if (commitment.facilityId !== config.facilityId) throw new Error(`latest commitment is for ${commitment.facilityId}, not ${config.facilityId}`)

	// 2. Private notice, fetched from inside the enclave with the Vault DON secret.
	const token = runtime.getSecret({ id: config.secretId }).result().value
	const noticeRes = http
		.sendRequest(runtime, {
			url: `${config.noticeUrl}?facility=${encodeURIComponent(config.facilityId)}&period=${commitment.periodId}${config.tamper ? '&tamper=1' : ''}`,
			method: 'GET',
			multiHeaders: { Authorization: { values: [`Bearer ${token}`] } },
		})
		.result()
	if (!ok(noticeRes)) throw new Error(`notice endpoint returned ${noticeRes.statusCode}`)
	const notice = noticeSchema.parse(json(noticeRes))

	// 3. Verify the notice against the public commitment. A changed rate, period or nonce fails here.
	const recomputed = keccak256(
		encodeAbiParameters(NOTICE_ABI, [
			notice.facilityId,
			BigInt(notice.periodId),
			BigInt(notice.periodStart),
			BigInt(notice.periodEnd),
			BigInt(notice.rateBps),
			BigInt(notice.dayCountBasis),
			notice.nonce as Hex,
		]),
	)
	if (recomputed.toLowerCase() !== commitment.commitment.toLowerCase()) {
		throw new Error(`notice does not match the committed hash for period ${commitment.periodId}; accrual aborted`)
	}

	// 4. Register snapshot: every holder's par balance from the ATS security in ONE call through the
	//    RegisterSnapshot helper, so the enclave's request count does not grow with the holder list.
	const days = BigInt(Math.floor((notice.periodEnd - notice.periodStart) / 86400))
	const holders = commitment.holders.map((h) => h.toLowerCase() as Hex)
	const data = encodeFunctionData({ abi: SNAPSHOT_ABI, functionName: 'snapshot', args: [config.loanToken as Hex, holders] })
	const callRes = http
		.sendRequest(runtime, {
			url: `${config.mirrorUrl}/api/v1/contracts/call`,
			method: 'POST',
			multiHeaders: { 'Content-Type': { values: ['application/json'] } },
			// Capability request bodies are raw bytes, carried as base64.
			body: bytesToBase64(new TextEncoder().encode(JSON.stringify({ to: config.snapshotReader, data, estimate: false }))),
		})
		.result()
	if (!ok(callRes)) throw new Error(`register snapshot failed: ${callRes.statusCode}`)
	const [pars] = decodeFunctionResult({ abi: SNAPSHOT_ABI, functionName: 'snapshot', data: mirrorCallSchema.parse(json(callRes)).result as Hex })
	const amounts = pars.map((par) => accrual(par, BigInt(notice.rateBps), days, BigInt(notice.dayCountBasis)))
	const total = amounts.reduce((a, b) => a + b, 0n)

	// Simulation-only log. Says nothing about the rate; remove before production.
	runtime.log(`Confidential accrual verified for ${config.facilityId} period ${commitment.periodId}: ${holders.length} holders, ${days} days, total ${total} mUSD units`)

	// 5. Cross back to the DON with the distribution only. The rate, basis and nonce stay inside.
	const donRuntime = runtime.usingTheDons()
	const encodedPayload = encodeAbiParameters(
		parseAbiParameters('bytes32 commitment, uint256 periodId, address[] holders, uint256[] amounts'),
		[commitment.commitment as Hex, BigInt(commitment.periodId), holders, amounts],
	)
	donRuntime
		.report({ encodedPayload: hexToBase64(encodedPayload), encoderName: 'evm', signingAlgo: 'ecdsa', hashingAlgo: 'keccak256' })
		.result()

	return JSON.stringify({
		facilityId: config.facilityId,
		periodId: commitment.periodId,
		commitment: commitment.commitment,
		days: days.toString(),
		distribution: holders.map((h, i) => ({ holder: h, amountUnits: amounts[i].toString() })),
		totalUnits: total.toString(),
	})
}

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()
	return [cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [{ tee: 'nitro', regions: ['us-west-2'] }])]
}
