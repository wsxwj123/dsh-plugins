import path from "node:path";
import fs from "node:fs";
//#region src/trash.ts
/**
* Recycle-bin store: durable on-disk layout + the four file primitives the
* /sm endpoints are built on.
*
* Layout (mirrors the executable contract, helpers.js):
*   <trashRoot>/<id>/            the moved session directory
*   <trashRoot>/_metadata/<id>.json   a durable record { id, originalDir, title,
*                                     deletedAt, projectKey }
*
* originalDir is kept ONLY in the on-disk record (for restore). It is never
* returned by /sm/trash (path-leak guard, INTERFACE §3.5 / F-1).
*
* The store never opens/reads/writes the session log body — it moves whole
* directories. Every primitive is idempotent-guarded by its caller (the
* handler decides "already done" via record/target existence); the store just
* performs the single, atomic rename/remove.
*/
/** Marker file that makes a directory a recognizable session directory. */
const SESSION_MARKER = "session.jsonl.zstd";
/** The metadata sub-directory inside the trash root. */
const METADATA_DIR = "_metadata";
/**
* A store bound to one trash root. All paths are computed from the root, so
* the store is trivially safe as long as the root itself is trusted (the
* handler asserts the trash root is outside the sessions scan).
*/
var TrashStore = class {
	root;
	metaDir;
	rmItem;
	constructor(root, opts = {}) {
		this.root = root;
		this.metaDir = path.join(root, METADATA_DIR);
		this.rmItem = opts.rmItem ?? defaultRmItem;
		fs.mkdirSync(this.metaDir, { recursive: true });
	}
	/** The absolute metadata record path for an id. */
	recordPath(id) {
		return path.join(this.metaDir, `${id}.json`);
	}
	/** The moved-directory location for an id. */
	itemPath(id) {
		return path.join(this.root, id);
	}
	recordIdForRecordFile(filename) {
		if (!filename.endsWith(".json")) return null;
		return filename.slice(0, -5);
	}
	readRecord(id) {
		const p = this.recordPath(id);
		if (!fs.existsSync(p)) return null;
		try {
			return JSON.parse(fs.readFileSync(p, "utf8"));
		} catch {
			return null;
		}
	}
	writeRecord(rec) {
		fs.mkdirSync(this.metaDir, { recursive: true });
		fs.writeFileSync(this.recordPath(rec.id), JSON.stringify(rec));
	}
	deleteRecord(id) {
		fs.rmSync(this.recordPath(id), { force: true });
	}
	/** Every stored record (for /sm/trash and restore lookups). */
	records() {
		if (!fs.existsSync(this.metaDir)) return [];
		const out = [];
		for (const f of fs.readdirSync(this.metaDir)) {
			const id = this.recordIdForRecordFile(f);
			if (id === null) continue;
			const rec = this.readRecord(id);
			if (rec !== null) out.push(rec);
		}
		return out;
	}
	/**
	* Move a whole session directory into the trash and write its durable
	* record. Throws on IO failure (caller maps to system-error); on success the
	* idempotent truth "the directory is no longer at originalDir" is real.
	*/
	moveToTrash(fromDir, rec) {
		const dest = this.itemPath(rec.id);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.renameSync(fromDir, dest);
		this.writeRecord({
			...rec,
			deletedAt: Date.now()
		});
	}
	/**
	* Item directory exists under the trash root.
	*/
	hasItem(id) {
		return fs.existsSync(this.itemPath(id));
	}
	/**
	* A record exists for the id.
	*/
	hasRecord(id) {
		return fs.existsSync(this.recordPath(id));
	}
	/**
	* Restore a trash item back to its recorded original directory. The caller
	* has already decided (order matters, INTERFACE §3.2) whether the record
	* exists, whether the original dir is free, and that the item dir exists.
	* This just performs the move and clears the record.
	*/
	restoreItem(rec) {
		const from = this.itemPath(rec.id);
		fs.mkdirSync(path.dirname(rec.originalDir), { recursive: true });
		fs.renameSync(from, rec.originalDir);
		this.deleteRecord(rec.id);
	}
	/**
	* Empty every real trash item (skips the metadata dir), removing records
	* after a successful (or partial) rm. Returns the list of ids that could NOT
	* be removed, so the caller can surface a system-error while keeping the
	* still-present items restorable. Any rm failure leaves that item's record
	* intact.
	*/
	empty() {
		if (!fs.existsSync(this.root)) return [];
		const failed = [];
		for (const entry of fs.readdirSync(this.root)) {
			if (entry === "_metadata") continue;
			try {
				if (this.rmItem(entry, this.root) === false) {
					failed.push(entry);
					continue;
				}
			} catch {
				failed.push(entry);
				continue;
			}
		}
		for (const rec of this.records()) if (!this.hasItem(rec.id)) this.deleteRecord(rec.id);
		return failed;
	}
};
/** Default removal: recursive, force, absent-safe. */
function defaultRmItem(id, trashRoot) {
	fs.rmSync(path.join(trashRoot, id), {
		recursive: true,
		force: true
	});
}
//#endregion
export { METADATA_DIR, SESSION_MARKER, TrashStore };
