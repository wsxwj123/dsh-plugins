import { TrashStore } from "./trash.js";
import { isInsideOrEqual } from "./paths.js";
import { createSmHandler } from "./handler.js";
import { isTrustedSmRequest } from "./trust-fence.js";
import path from "node:path";
import os from "node:os";
//#region src/index.ts
/**
* Node half of dsh-session-manager — a Cordis plugin.
*
* Responsibilities (PLAN §4 T2/T3):
*  1. Mount the raw /sm/* RPC surface on the web server, protected by the
*     loopback trust fence, with recycle-bin file operations
*     (delete/restore/emptyTrash/trash) and the workspace archive-set write
*     (delete-archived step-2 / unarchive).
*  2. Services are declared in `inject` (webServer / storageDomain / sessions)
*     and accessed BARE (cordis red line #1: an inject-declared service may be
*     bare-accessed). The web profile shines all three, so route mounting works
*     reliably — this mirrors the aionui-panel pattern (`inject: [webServer,
*     ...]` + `ctx.webServer.register(...)`), which demonstrably mounts its
*     routes on the real web profile.
*
* P7 note: an earlier attempt read services via `ctx.get` (and a
* `ctx.root.get ?? ctx.get` fallback) with an EMPTY inject, on the premise that
* absent services should degrade gracefully. It never mounted /sm (POST 405):
* `get` walks the current ctx's isolate and the plugin's isolated ctx did not
* carry the service symbols. Injecting the services (like aionui-panel) is the
* correct, proven path. Cordis treats inject entries as hard activation
* deps: a profile lacking these services leaves the plugin `pending` rather
* than crashing load — acceptable, because this plugin is only installed in the
* web profile where they all exist.
*/
const name = "dsh-session-manager";
/**
* Services this plugin needs. Injecting them makes them BARE-accessible (red
* line #1 allows bare access to inject-declared services) and makes cordis
* block activation until they're all active — the same wiring the aionui-panel
* plugin uses to mount its routes reliably. `connection` is NOT needed: the
* /sm route is a raw prefix route mounted directly on webServer (not a
* connection.rpc envelope).
*/
const inject = [
	"webServer",
	"storageDomain",
	"sessions"
];
/** Resolve effective roots: CLI/config -> env override -> DSH defaults. */
function resolveRoots(config) {
	const home = os.homedir();
	return {
		sessionsRoot: config.sessionsRoot ?? path.join(home, ".dsh", "sessions"),
		trashRoot: process.env.SM_TRASH_ROOT?.trim() || config.trashRoot || path.join(home, ".dsh", "session-manager-trash")
	};
}
/**
* Consume the raw request body (I-4). NEVER rejects: a mid-stream failure —
* client abort (ECONNRESET) or a transport error — resolves to null, which the
* route maps to a structured 400. The old bare `for await` threw inside the
* async route handler on an aborted connection, producing an unhandled
* rejection that left the request hanging.
*/
async function readRequestBody(req) {
	try {
		let raw = "";
		req.setEncoding("utf8");
		for await (const chunk of req) raw += chunk;
		return raw;
	} catch {
		return null;
	}
}
function sendJson(res, status, json) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(json));
}
function apply(ctx, config = {}) {
	const { sessionsRoot, trashRoot } = resolveRoots(config);
	if (isInsideOrEqual(sessionsRoot, trashRoot)) {
		ctx.logger.warn(`[session-manager] trash root ${trashRoot} is inside sessions root ${sessionsRoot}; refusing to enable recycle bin`);
		return;
	}
	const storageDomain = ctx.storageDomain;
	const sessions = ctx.sessions;
	if (!storageDomain) ctx.logger.warn("[session-manager] storageDomain service unavailable; archive write (unarchive / delete-of-archived) will degrade to workspace-domain-unavailable / system-error");
	if (!sessions) ctx.logger.warn("[session-manager] sessions service unavailable; host-authoritative cwd resolution is skipped and deletes use the client-supplied cwd");
	const trash = new TrashStore(trashRoot);
	/**
	* Read the current workspace global object. I-1: a THROWN read (storage
	* fault) returns the `undefined` sentinel — distinguishable from "domain
	* absent / empty global" (`{}`). The handler maps `undefined` to a retryable
	* system-error and never spreads it into a write payload, so a read failure
	* can no longer silently skip archive cleanup or clobber workspaceIds/
	* initialized with `{ ...{}, archivedSessionIds }`.
	*/
	const readGlobal = () => {
		if (!storageDomain) return {};
		const domain = storageDomain.get("workspace");
		if (!domain || typeof domain.global?.get !== "function") return {};
		try {
			const v = domain.global.get();
			return v && typeof v === "object" ? v : {};
		} catch {
			return;
		}
	};
	const handler = createSmHandler({
		sessionsRoot,
		trash,
		sessions,
		storageDomain,
		readWorkspaceGlobal: readGlobal,
		log: { warn: (m) => ctx.logger.warn(`[session-manager] ${m}`) }
	});
	const webServer = ctx.webServer;
	if (!webServer || typeof webServer.register !== "function") {
		ctx.logger.warn("[session-manager] webServer service unavailable; /sm routes are not mounted");
		return;
	}
	const dispose = webServer.register({
		kind: "prefix",
		path: "/sm",
		handler: async (req, res) => {
			if (!isTrustedSmRequest(req)) {
				res.writeHead(403);
				res.end("forbidden");
				return;
			}
			const m = /^\/sm\/([^/?#]+)/.exec(req.url ?? "");
			const method = m ? m[1] : void 0;
			if (!method) {
				res.writeHead(404);
				res.end("not found");
				return;
			}
			try {
				const raw = await readRequestBody(req);
				if (raw === null) {
					sendJson(res, 400, {
						ok: false,
						code: "bad-request",
						message: "request body read failed"
					});
					return;
				}
				let body;
				if (raw.length === 0) body = void 0;
				else try {
					body = JSON.parse(raw);
				} catch {
					sendJson(res, 400, {
						ok: false,
						code: "bad-request",
						message: "invalid JSON"
					});
					return;
				}
				const result = handler.handle(method, req, body);
				res.writeHead(result.status, { "content-type": "application/json" });
				res.end(JSON.stringify(result.json));
			} catch (err) {
				try {
					if (!res.headersSent) res.writeHead(400, { "content-type": "application/json" });
					res.end(JSON.stringify({
						ok: false,
						code: "bad-request",
						message: "request failed"
					}));
				} catch {}
			}
		}
	});
	ctx.effect(() => dispose);
}
//#endregion
export { apply, inject, name, readRequestBody, resolveRoots };
