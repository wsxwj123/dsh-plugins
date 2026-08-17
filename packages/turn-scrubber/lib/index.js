function isNumberArray(value) {
	return Array.isArray(value) && value.every((item) => typeof item === "number");
}
/**
* Extract plain text from an event field, which may be a string, a content
* block array (`[{type:"text",text:"..."}, ...]`), or a structured object —
* the same tolerances the rail's `textOfContent` applies to chat nodes.
*/
function textOfContent(value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		let out = "";
		for (const block of value) if (typeof block === "string") out += block;
		else if (block !== null && typeof block === "object") {
			const b = block;
			if (typeof b.text === "string") out += b.text;
			else if (typeof b.content === "string") out += b.content;
		}
		return out;
	}
	if (value !== null && typeof value === "object") {
		const c = value;
		if (typeof c.text === "string") return c.text;
		if (typeof c.content === "string") return c.content;
	}
	return "";
}
/**
* Build the full turn index from an ordered event feed.
*
* Single pass per concern:
* 1. collect every `compaction/*.shadowedSeqs` and the compaction summary texts;
* 2. segment turns by `turn/start`, tracking first/last `user/message` facts;
* 3. assemble per-turn entries (compacted flag + preview source).
*
* @param events - ordered session events (append order, seq ascending).
* @returns the index; empty feed yields `{asOfSeq:-1, total:0, turns:[]}`.
*/
function buildTurnIndex(events) {
	const shadowedSeqs = /* @__PURE__ */ new Set();
	const summaries = [];
	for (const event of events) {
		const type = event.type;
		const data = event.data;
		if (type === "compaction/summary" || type === "compaction/prune") {
			if (isNumberArray(data?.shadowedSeqs)) for (const seq of data.shadowedSeqs) shadowedSeqs.add(seq);
		}
		if (type === "compaction/summary") summaries.push({
			seq: typeof event.seq === "number" ? event.seq : -1,
			text: textOfContent(data?.summary),
			shadowedSeqs: isNumberArray(data?.shadowedSeqs) ? data.shadowedSeqs : []
		});
	}
	const buckets = /* @__PURE__ */ new Map();
	let currentTurn;
	for (const event of events) {
		const type = event.type;
		const data = event.data;
		if (type === "turn/start") {
			const turn = typeof data?.turn === "number" ? data.turn : void 0;
			if (turn === void 0) continue;
			currentTurn = turn;
			if (!buckets.has(turn)) buckets.set(turn, {
				turn,
				lastUserText: ""
			});
			continue;
		}
		if (type !== "user/message") continue;
		if (currentTurn === void 0) continue;
		const bucket = buckets.get(currentTurn);
		if (bucket === void 0) continue;
		if (bucket.firstUserSeq === void 0 && typeof event.seq === "number") bucket.firstUserSeq = event.seq;
		bucket.lastUserText = textOfContent(data?.content);
	}
	const turns = [];
	const sorted = [...buckets.values()].sort((left, right) => left.turn - right.turn);
	for (const bucket of sorted) {
		const firstUserSeq = bucket.firstUserSeq;
		const compacted = firstUserSeq !== void 0 && shadowedSeqs.has(firstUserSeq);
		let preview = bucket.lastUserText;
		if (compacted) {
			let summaryText = "";
			for (const summary of summaries) if (summary.shadowedSeqs.includes(firstUserSeq)) summaryText = summary.text;
			if (summaryText !== "") preview = summaryText;
		}
		turns.push({
			turn: bucket.turn,
			preview: preview.slice(0, 120),
			compacted
		});
	}
	let asOfSeq = -1;
	for (const event of events) if (typeof event.seq === "number") asOfSeq = event.seq;
	return {
		asOfSeq,
		total: turns.length,
		turns
	};
}
//#endregion
//#region src/index.ts
/**
* Node half of dsh-turn-scrubber: serves the full turn index for any session
* on a loopback connection.rpc channel.
*
* The rail needs per-turn facts that only exist on the host (total turn count,
* compaction markers, previews of not-yet-loaded turns). This half answers
* one read-only endpoint:
*
*   POST {origin}/turn-scrubber/turnIndex   {type:'client-request',rpcId,method:'turnIndex',payload:{sessionId}}
*
* Data source (live first, then persistence cold read):
*   1. `ctx.sessions.get(sessionId)` exists → its append-only `events`;
*   2. otherwise `sessionPersistence.inspect(sessionId)` → `{meta, events}`;
*   3. neither → `session-not-found`.
*
* Response contract (INTERFACE §1.3/§1.4): business errors are ALWAYS HTTP 200
* with `result.ok === false`; the envelope layer alone decides non-200 codes.
*/
/** Services required on the host before this plugin may apply. */
const inject = [
	"connection",
	"sessionPersistence",
	"sessions"
];
/** Stable, content-free failure messages (INTERFACE §1.4: message 不含会话内容). */
const MESSAGE = {
	notFound: "session not found",
	unavailable: "session history unavailable",
	badRequest: "sessionId is required"
};
const okResponse = (sessionId, built) => ({
	ok: true,
	sessionId,
	asOfSeq: built.asOfSeq,
	total: built.total,
	turns: built.turns
});
/**
* Build the index for one session from live store first, persistence cold read
* as fallback. Subagent-owned identities are refused as `session-not-found`
* (PLAN risk 4: subagent lifecycle belongs to its own routing).
*/
async function resolveIndex(ctx, sessionId, signal) {
	try {
		const live = ctx.sessions.get(sessionId);
		if (live !== void 0) {
			if (live.header.origin === "subagent") return {
				ok: false,
				error: {
					code: "session-not-found",
					message: MESSAGE.notFound,
					details: { sessionId }
				}
			};
			return okResponse(sessionId, buildTurnIndex([...live.events]));
		}
		const persistence = ctx.sessionPersistence;
		if (persistence === void 0) return {
			ok: false,
			error: {
				code: "session-not-found",
				message: MESSAGE.notFound,
				details: { sessionId }
			}
		};
		const inspected = await persistence.inspect(sessionId, signal);
		if (inspected.meta.origin === "subagent") return {
			ok: false,
			error: {
				code: "session-not-found",
				message: MESSAGE.notFound,
				details: { sessionId }
			}
		};
		return okResponse(sessionId, buildTurnIndex(inspected.events));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			error: {
				code: message.includes("not found") ? "session-not-found" : "unavailable",
				message: message.includes("not found") ? MESSAGE.notFound : MESSAGE.unavailable,
				details: { sessionId }
			}
		};
	}
}
/** The single endpoint handler for the `/turn-scrubber` channel. */
function turnIndexHandler(ctx) {
	return async (endpoint, payload, signal) => {
		if (endpoint !== "turnIndex") return {
			ok: false,
			error: {
				code: "bad-request",
				message: MESSAGE.badRequest,
				details: {}
			}
		};
		const sessionId = payload?.sessionId;
		if (typeof sessionId !== "string" || sessionId === "") return {
			ok: false,
			error: {
				code: "bad-request",
				message: MESSAGE.badRequest,
				details: {}
			}
		};
		return resolveIndex(ctx, sessionId, signal);
	};
}
function apply(ctx) {
	ctx.connection.rpc.handle("/turn-scrubber", turnIndexHandler(ctx), { authority: "loopback" });
}
//#endregion
export { apply, inject };
