import { isInsideOrEqual } from "./paths.js";
import { TrashStore } from "./trash.js";
import { t as WORKSPACE_DOMAIN } from "./constants-B5ET8slt.js";
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
* Absolute locations that must never serve as the trash root, even if a
* misconfigured `SM_TRASH_ROOT` / config points at them (SECURITY-REPORT S1).
* The startup check is the PRIMARY defense: empty() recursively removes the
* root's contents, so a root aimed at (or containing) user/system data would
* turn "empty trash" into a destructive delete of unrelated files.
*/
const SYSTEM_TRASH_ROOT_DENYLIST = [
	"/tmp",
	"/var",
	"/var/tmp",
	"/usr",
	"/etc",
	"/bin",
	"/sbin",
	"/lib",
	"/opt",
	"/System",
	"/Library",
	"/Applications",
	"/private",
	"C:\\Windows",
	"C:\\Program Files",
	"C:\\Program Files (x86)",
	"C:\\ProgramData",
	"C:\\Users"
];
/**
* Why `trashRoot` is unsafe as the recycle-bin root, or null when it is safe.
* Rejects: the filesystem root, the home directory, any ANCESTOR of home
* (e.g. /Users, /home, C:\Users — empty() would reach real user data), the
* system temp dir, and the known system directories above.
*/
function trashRootUnsafeReason(trashRoot, home = os.homedir()) {
	const resolved = path.resolve(trashRoot);
	if (resolved === path.parse(resolved).root) return "the filesystem root";
	if (resolved === path.resolve(home)) return "the home directory";
	if (isInsideOrEqual(resolved, home)) return "an ancestor of the home directory";
	if (resolved === path.resolve(os.tmpdir())) return "the system temp directory";
	for (const sys of SYSTEM_TRASH_ROOT_DENYLIST) if (path.resolve(sys) === resolved) return `the system directory ${sys}`;
	return null;
}
/** Max /sm request body in BYTES; larger bodies are refused 413 (S2). */
const MAX_BODY_BYTES = 65536;
/**
* Consume the raw request body (I-4 + S2). NEVER rejects: a mid-stream failure
* — client abort (ECONNRESET) or a transport error — resolves to
* `{ ok:false, code:'read-failed' }`, which the route maps to a structured
* 400. A body that exceeds `limit` resolves to `{ ok:false, code:'too-large' }`
* (route maps it to 413) WITHOUT buffering the excess. The count is
* byte-accurate: raw Buffers are measured, so multibyte UTF-8 payloads cannot
* slip past the limit.
*/
async function readRequestBody(req, limit = MAX_BODY_BYTES) {
	const declared = Number(req.headers["content-length"]);
	if (Number.isFinite(declared) && declared > limit) return {
		ok: false,
		code: "too-large"
	};
	try {
		const chunks = [];
		let size = 0;
		for await (const chunk of req) {
			const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += buf.byteLength;
			if (size > limit) return {
				ok: false,
				code: "too-large"
			};
			chunks.push(buf);
		}
		return {
			ok: true,
			body: Buffer.concat(chunks).toString("utf8")
		};
	} catch {
		return {
			ok: false,
			code: "read-failed"
		};
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
	const unsafe = trashRootUnsafeReason(trashRoot);
	if (unsafe !== null) {
		ctx.logger.warn(`[session-manager] trash root ${trashRoot} is ${unsafe}; refusing to enable recycle bin`);
		return;
	}
	const storageDomain = ctx.storageDomain;
	const sessions = ctx.sessions;
	if (!storageDomain) ctx.logger.warn("[session-manager] storageDomain service unavailable; archive write (unarchive / delete-of-archived) will degrade to workspace-domain-unavailable / system-error");
	if (!sessions) ctx.logger.warn("[session-manager] sessions service unavailable; host-authoritative cwd resolution is skipped and deletes use the client-supplied cwd");
	const trash = new TrashStore(trashRoot, { log: { warn: (m) => ctx.logger.warn(`[session-manager] ${m}`) } });
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
		const domain = storageDomain.get(WORKSPACE_DOMAIN);
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
			if (req.method !== "POST") {
				res.writeHead(405, { allow: "POST" });
				res.end("method not allowed");
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
				const read = await readRequestBody(req);
				if (!read.ok) {
					if (read.code === "read-failed") {
						sendJson(res, 400, {
							ok: false,
							code: "bad-request",
							message: "request body read failed"
						});
						return;
					}
					sendJson(res, 413, {
						ok: false,
						code: "payload-too-large",
						message: `request body exceeds ${MAX_BODY_BYTES} bytes`
					});
					return;
				}
				const raw = read.body;
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
export { MAX_BODY_BYTES, apply, inject, name, readRequestBody, resolveRoots, trashRootUnsafeReason };
