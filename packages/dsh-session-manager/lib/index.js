import { TrashStore } from "./trash.js";
import { archiveFromGlobal, createSmHandler } from "./handler.js";
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
*  2. Use ONLY core ctx members (logger/get/effect/on/emit). Every service
*     (storageDomain / sessions / webServer) is read through `ctx.get` (never
*     bare), so a missing service degrades to a logged no-op instead of
*     blocking plugin activation.
*
* Cordis access discipline (the dsh-pet-bridge crash lesson): we never touch a
* service property bare — `ctx.<service>` outside the inject list throws
* "cannot get property without inject". And this plugin deliberately keeps its
* `inject` EMPTY so it never becomes a hard activation dependency: cordis waits
* on injected services, so injecting one that a headless profile lacks leaves
* the plugin `pending` forever and fails the whole profile load (the e2e
* startup crash). Everything is an optional `ctx.get`, presence-gated.
*/
const name = "dsh-session-manager";
/**
* Deliberately empty. Cordis treats inject entries as hard activation
* dependencies (absent service → plugin `.pending` forever → whole profile load
* fails). To survive headless profiles that lack storageDomain/sessions, every
* service is read optionally via ctx.get instead. Presence is checked at
* apply() time; a missing service degrades the affected endpoints (documented
* on each) without crashing or hanging activation.
*/
const inject = [];
/** Resolve effective roots: CLI/config -> env override -> DSH defaults. */
function resolveRoots(config) {
	const home = os.homedir();
	return {
		sessionsRoot: config.sessionsRoot ?? path.join(home, ".dsh", "sessions"),
		trashRoot: process.env.SM_TRASH_ROOT?.trim() || config.trashRoot || path.join(home, ".dsh", "session-manager-trash")
	};
}
/**
* Build the /sm dispatch with a production storage-domain facility. Kept as a
* separate exported function so tests can wire a real handler without booting
* cordis, and so the archive read helpers stay in one place.
*/
function makeHandler(deps) {
	return createSmHandler(deps);
}
function apply(ctx, config = {}) {
	const { sessionsRoot, trashRoot } = resolveRoots(config);
	if (isTrashInside(sessionsRoot, trashRoot)) {
		ctx.logger.warn(`[session-manager] trash root ${trashRoot} is inside sessions root ${sessionsRoot}; refusing to enable recycle bin`);
		return;
	}
	const rootGet = (name) => ctx.root.get(name) ?? ctx.get(name);
	const storageDomain = rootGet("storageDomain");
	const sessions = rootGet("sessions");
	if (!storageDomain) ctx.logger.warn("[session-manager] storageDomain service unavailable; archive write (unarchive / delete-of-archived) will degrade to workspace-domain-unavailable / system-error");
	if (!sessions) ctx.logger.warn("[session-manager] sessions service unavailable; running-session guard is skipped and deletes proceed");
	const trash = new TrashStore(trashRoot);
	/** Read the current workspace global object; {} when the domain is absent. */
	const readGlobal = () => {
		if (!storageDomain) return {};
		const domain = storageDomain.get("workspace");
		if (!domain || typeof domain.global?.get !== "function") return {};
		try {
			const v = domain.global.get();
			return v && typeof v === "object" ? v : {};
		} catch {
			return {};
		}
	};
	const handler = createSmHandler({
		sessionsRoot,
		trash,
		sessions,
		storageDomain,
		readArchived: () => archiveFromGlobal(readGlobal()),
		readWorkspaceGlobal: readGlobal,
		log: { warn: (m) => ctx.logger.warn(`[session-manager] ${m}`) }
	});
	const webServer = rootGet("webServer");
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
			let raw = "";
			req.setEncoding("utf8");
			for await (const chunk of req) raw += chunk;
			let body;
			if (raw.length === 0) body = void 0;
			else try {
				body = JSON.parse(raw);
			} catch {
				res.writeHead(400, { "content-type": "application/json" });
				res.end(JSON.stringify({
					ok: false,
					code: "bad-request",
					message: "invalid JSON"
				}));
				return;
			}
			const result = handler.handle(method, req, body);
			res.writeHead(result.status, { "content-type": "application/json" });
			res.end(JSON.stringify(result.json));
		}
	});
	ctx.effect(() => dispose);
}
/** Whether one root resolves inside another (startup guard). */
function isTrashInside(sessionsRoot, trashRoot) {
	const s = path.resolve(sessionsRoot);
	const t = path.resolve(trashRoot);
	return t === s || t.startsWith(s + path.sep);
}
//#endregion
export { apply, inject, makeHandler, name, resolveRoots };
