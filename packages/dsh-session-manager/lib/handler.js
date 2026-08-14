import { assertValidId, isInsideOrEqual, isStableSegment, lookupProjectDir, sessionSegment } from "./paths.js";
import path from "node:path";
import fs from "node:fs";
//#region src/handler.ts
/**
* Core /sm handler — the executable surface that the cordis node half mounts
* (src/index.ts) and that the acceptance bridge tests drive. This factory
* reproduces, match-for-match, the contract image in tests/acceptance/helpers.js
* (same per-endpoint判定顺序, same idempotency truth values, same error codes,
* same HTTP/JSON shape).
*
* Wire note (important): the /sm surface here is a RAW HTTP route — it returns
* `{ ok: true, … }` directly and accepts a RAW body `{ id, cwd, title }`. That
* is exactly what the locked acceptance suite asserts and what the browser
* client half speaks. The official `connection.rpc.handle` envelope
* (`{ type, rpcId, method, payload }` → `{ type, rpcId, result }`) is NOT the
* /sm contract, so this plugin mounts its own raw prefix route and applies the
* same loopback trust fence (src/trust-fence.ts). See the final report for the
* plan-interface conflict this resolves.
*/
function ok() {
	return {
		status: 200,
		json: { ok: true }
	};
}
function fail(code, message) {
	return {
		status: 200,
		json: {
			ok: false,
			code,
			message
		}
	};
}
function bad(code, message) {
	return {
		status: 400,
		json: {
			ok: false,
			code,
			message
		}
	};
}
function bodyIsObject(body) {
	return typeof body === "object" && body !== null && !Array.isArray(body);
}
/**
* Resolve the project dir for a delete, honoring an optional test override.
* The override + the shared lookup cover the harness's projectCwdMap semantics.
*/
function resolveLookup(deps, cwd) {
	const base = lookupProjectDir(deps.sessionsRoot, cwd);
	if (base.kind !== "dir") return base;
	if (typeof cwd === "string" && deps.projectDirOverride) {
		const mapped = deps.projectDirOverride(cwd);
		if (mapped !== void 0) return {
			kind: "dir",
			projectDir: mapped
		};
	}
	return base;
}
/**
* Create the /sm handler. `handle(method, req, body)` returns the HTTP status
* + JSON to send for one request. The loopback trust fence is applied by the
* route owner (src/index.ts); this function operates on already-trusted input.
*/
function createSmHandler(deps) {
	const log = deps.log ?? { warn: () => {} };
	function doDelete(_req, body) {
		if (!bodyIsObject(body)) return bad("bad-request", "body must be an object");
		const { id, cwd, title, force } = body;
		if (!assertValidId(id)) return bad("invalid-id", "invalid id");
		if (cwd !== void 0 && cwd !== null && typeof cwd !== "string") return bad("invalid-cwd", "invalid cwd");
		if (title !== void 0 && title !== null) {
			if (typeof title !== "string" || title.length > 256) return bad("invalid-title", "invalid title");
		}
		if (force !== void 0 && typeof force !== "boolean") return bad("invalid-force", "invalid force");
		const liveSession = deps.sessions?.get(id);
		const proj = resolveLookup(deps, (liveSession && typeof liveSession.header?.cwd === "string" && liveSession.header.cwd.length > 0 ? liveSession.header.cwd : void 0) ?? cwd);
		if (proj.kind === "invalid") return bad("invalid-cwd", "invalid cwd");
		if (proj.kind === "not-found") return fail("session-dir-not-found", "project dir not found");
		if (!isStableSegment(id)) return fail("path-out-of-bounds", "id escapes segment encoding");
		const targetDir = sessionSegment(proj.projectDir, id);
		if (!isInsideOrEqual(deps.sessionsRoot, targetDir)) return fail("path-out-of-bounds", "target outside sessions root");
		if (!fs.existsSync(targetDir)) {
			if (deps.trash.hasItem(id)) return doArchivedCleanup(id);
			if (liveSession) return doArchivedCleanup(id);
			return fail("session-dir-not-found", "session dir not found");
		}
		try {
			deps.trash.moveToTrash(targetDir, {
				id,
				originalDir: targetDir,
				title: typeof title === "string" ? title : null,
				projectKey: path.basename(proj.projectDir)
			});
		} catch (err) {
			return fail("system-error", String(err));
		}
		return doArchivedCleanup(id);
	}
	function doArchivedCleanup(id) {
		if (!deps.readArchived().includes(id)) return ok();
		const domain = deps.storageDomain?.get("workspace");
		if (domain === null || domain === void 0) {
			log.warn(`archive cleanup for ${id}: workspace domain unavailable after file moved; retry to complete`);
			return fail("system-error", "archive cleanup failed; file already moved, retry to complete");
		}
		try {
			const current = deps.readWorkspaceGlobal();
			const next = deps.readArchived().filter((x) => x !== id);
			domain.global.set({
				...current,
				archivedSessionIds: next
			});
			return ok();
		} catch (err) {
			log.warn(`archive cleanup for ${id} failed: ${String(err)}`);
			return fail("system-error", String(err));
		}
	}
	function doRestore(_req, body) {
		if (!bodyIsObject(body)) return bad("bad-request", "body must be an object");
		const { id } = body;
		if (!assertValidId(id)) return bad("invalid-id", "invalid id");
		const rec = deps.trash.readRecord(id);
		if (rec === null) return fail("not-in-trash", "no such trash entry");
		if (fs.existsSync(rec.originalDir)) return fail("restore-target-exists", "original dir occupied; refusing to overwrite");
		if (!deps.trash.hasItem(rec.id)) return fail("system-error", "trash entry dir missing");
		try {
			deps.trash.restoreItem(rec);
			return ok();
		} catch (err) {
			return fail("system-error", String(err));
		}
	}
	function doEmptyTrash(_req, body) {
		if (!bodyIsObject(body) || body.confirm !== true) return bad("confirmation-required", "confirm:true required");
		try {
			const failed = deps.trash.empty();
			if (failed.length > 0) {
				log.warn(`emptyTrash partial failure on: ${failed.join(", ")}`);
				return fail("system-error", `could not remove: ${failed.join(", ")}`);
			}
			return ok();
		} catch (err) {
			return fail("system-error", String(err));
		}
	}
	function doUnarchive(_req, body) {
		if (!bodyIsObject(body)) return bad("bad-request", "body must be an object");
		const { id } = body;
		if (!assertValidId(id)) return bad("invalid-id", "invalid id");
		const domain = deps.storageDomain?.get("workspace");
		if (domain === null || domain === void 0) return fail("workspace-domain-unavailable", "workspace storage domain unavailable");
		const archived = deps.readArchived();
		if (!archived.includes(id)) return ok();
		try {
			const current = deps.readWorkspaceGlobal();
			const next = archived.filter((x) => x !== id);
			domain.global.set({
				...current,
				archivedSessionIds: next
			});
			return ok();
		} catch (err) {
			return fail("system-error", String(err));
		}
	}
	function doTrash() {
		return {
			status: 200,
			json: {
				ok: true,
				items: deps.trash.records().map((r) => ({
					id: r.id,
					title: r.title ?? void 0,
					deadline: r.deletedAt
				}))
			}
		};
	}
	return { handle(method, _req, body) {
		switch (method) {
			case "delete": return doDelete(_req, body);
			case "restore": return doRestore(_req, body);
			case "emptyTrash": return doEmptyTrash(_req, body);
			case "unarchive": return doUnarchive(_req, body);
			case "trash": return doTrash();
			default: return {
				status: 404,
				json: {
					ok: false,
					error: "not found"
				}
			};
		}
	} };
}
/**
* Data helpers for the workspace archive domain, so src/index.ts can wire a
* production storage-domain facility into the handler without re-deriving the
* field names.
*/
function archiveFromGlobal(global) {
	if (!global || typeof global !== "object") return [];
	const a = global.archivedSessionIds;
	return Array.isArray(a) ? a : [];
}
//#endregion
export { archiveFromGlobal, createSmHandler };
