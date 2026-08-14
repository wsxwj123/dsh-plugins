import path from "node:path";
//#region src/paths.ts
/**
* Path encoding + bounds helpers for the session recycle bin.
*
* The node half targets the REAL DSH on-disk session layout, so it uses the
* actual DSH encoders (dsh-session-persistence-jsonl):
*
*     projectDir(root, cwd) = join(root, "_no-cwd")            // cwd undefined/null
*                           = join(root, projectKey(cwd))       // otherwise
*     sessionDir(root,cwd,id) = join(projectDir(root,cwd), encodeSegment(id))
*
* where `projectKey` folds a cwd path into a `--<readable>--` segment and
* `encodeSegment` escapes an id into a `~XXXX` segment. The locked acceptance
* suite (tests/acceptance) deliberately models a SIMPLIFIED literal layout
* (`join(root, cwd, id)`) as a standalone contract mirror that runs against
* its own harness backend; the node half here implements the real-encoding
* semantics, and tests/integration adapts its fixtures to the encoded layout so
* the same scenarios still pass against the shipped handler.
*/
const INVALID_ID_CHARSET = /[\\/\n\r\t\0\u0000-\u001f]/;
/** The project-directory segment DSH uses for a session without a cwd. */
const NO_CWD_DIR = "_no-cwd";
/**
* 400-level id validity gate (INTERFACE §3.1 invalid-id). Rejects only the
* inputs the harness asserts must be a 400:
*  - non-string / empty
*  - exact `.` / `..`
*  - path separator, newline, tab, NUL or other control char
* NOTE: it does NOT reject `%` — `%` ids pass this gate and are instead
* rejected one level down as `path-out-of-bounds` (200) by isStableSegment,
* exactly as the harness separates the two stages.
*/
function assertValidId(id) {
	if (typeof id !== "string" || id.length === 0) return false;
	if (id === "." || id === "..") return false;
	if (id === "_metadata") return false;
	if (INVALID_ID_CHARSET.test(id)) return false;
	if (path.basename(id) !== id) return false;
	return true;
}
/**
* 200-level "stable segment" gate, used by /sm/delete before the
* path-out-of-bounds check. An id that fails this still passed assertValidId
* (400) but cannot be placed as a single on-disk segment without ambiguity —
* e.g. it contains `%` which would collide with the `~XXXX` escape encoding.
*/
function isStableSegment(id) {
	if (id.includes("%")) return false;
	return path.basename(id) === id;
}
/**
* Production-faithful encodeSegment (dsh-session-persistence-jsonl): escapes
* every character outside the safe set into `~XXXX` (hex of the code point).
* Safe chars `[A-Za-z0-9._-]` pass through unchanged, so a stable id (safe
* charset) yields `encodeSegment(id) === id`.
*/
function encodeSegment(raw) {
	if (raw.length === 0) throw new Error("cannot encode an empty path segment");
	if (raw === ".") return "~002E";
	if (raw === "..") return "~002E~002E";
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
		else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
	}
	return out;
}
/**
* Production-faithful projectKey (dsh-session-persistence-jsonl): folds a cwd
* path into a single `--<readable>--` directory segment. Separators collapse
* to `-`, unsafe characters escape to `~XXXX`.
*/
function projectKey(cwd) {
	if (cwd.length === 0) throw new Error("cannot encode an empty project path");
	let readable = "";
	let separatorRun = false;
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === "/" || ch === "\\" || ch === ":") {
			if (!separatorRun) readable += "-";
			separatorRun = true;
		} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}
function lookupProjectDir(root, cwd) {
	if (cwd === void 0 || cwd === null) return {
		kind: "dir",
		projectDir: path.join(root, NO_CWD_DIR)
	};
	if (typeof cwd !== "string") return { kind: "invalid" };
	if (cwd.length === 0) return { kind: "not-found" };
	return {
		kind: "dir",
		projectDir: path.join(root, projectKey(cwd))
	};
}
/**
* True when `child` resolves strictly inside `parent` (or equals `parent`).
* Backs the path-out-of-bounds gate (target must stay under the configured
* sessions root) and confirms the trash root lives outside the sessions scan.
*/
function isInsideOrEqual(parent, child) {
	const p = path.resolve(parent);
	const c = path.resolve(child);
	return c === p || c.startsWith(p + path.sep);
}
/**
* The session directory for a delete: `join(projectDir, encodeSegment(id))`.
* The id is already validated by assertValidId (no separator, no `.`/`..`), so
* `encodeSegment` cannot introduce a path separator; a stable id encodes to
* itself (safe charset).
*/
function sessionSegment(projectDir, id) {
	return path.join(projectDir, encodeSegment(id));
}
//#endregion
export { NO_CWD_DIR, assertValidId, encodeSegment, isInsideOrEqual, isStableSegment, lookupProjectDir, projectKey, sessionSegment };
