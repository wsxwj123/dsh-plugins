import path from "node:path";
//#region src/paths.ts
/**
* Path encoding + bounds helpers for the session recycle bin.
*
* The actionable contract (INTERFACE §3, enforced by the locked acceptance
* suite) models a session directory as a simple literal path:
*
*     sessionDir = join(sessionsRoot, <cwd>, <id>)
*
* where both `<cwd>` and `<id>` are used as raw single path segments — NOT the
* real DSH encoders (`projectKey` → `--…--`, `encodeSegment` → `~XXXX`).
* Rationale: the recycle-bin scope is a configured host-side sessions root and
* a set of well-behaved ids/cwd labels; the contract's safety gate is "id/cwd
* carry no path-meaningful character", not the DSH logging encoders.
*/
const INVALID_ID_CHARSET = /[\\/\n\r\t\0\u0000-\u001f]/;
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
	if (INVALID_ID_CHARSET.test(id)) return false;
	if (path.basename(id) !== id) return false;
	return true;
}
/**
* 200-level "stable literal segment" gate, used by /sm/delete before the
* path-out-of-bounds check. An id that fails this still passed assertValidId
* (400) but cannot be placed as a literal segment without ambiguity — the
* harness encodes it (basename mismatch → URL-encode, or contains `%`) and the
* encoded form differs from the input, so it is `path-out-of-bounds`.
*/
function isStableSegment(id) {
	if (id.includes("%")) return false;
	return path.basename(id) === id;
}
/**
* Production-faithful encodeSegment (dsh-session-persistence-jsonl). Not used
* by the delete resolution (the contract uses literal segments) — exported for
* feature completeness and future hardening.
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
* Production-faithful projectKey (dsh-session-persistence-jsonl). Exported for
* completeness; not used by delete resolution.
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
		projectDir: root
	};
	if (typeof cwd !== "string") return { kind: "invalid" };
	if (cwd.length === 0) return { kind: "not-found" };
	return {
		kind: "dir",
		projectDir: path.join(root, cwd)
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
* The session directory for a delete: literal `join(projectDir, id)`. The id
* is already validated by assertValidId (no separator, no `.`/`..`), so `join`
* cannot escape the project dir.
*/
function sessionSegment(projectDir, id) {
	return path.join(projectDir, id);
}
//#endregion
export { assertValidId, encodeSegment, isInsideOrEqual, isStableSegment, lookupProjectDir, projectKey, sessionSegment };
