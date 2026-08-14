//#region src/client/pendingDeletesCore.ts
/**
* pendingDeletesCore — the pure, dependency-injected deferred-deletion state
* machine (no browser globals, no bridge import). Kept in its own module so a
* node unit test can import the compiled `lib/pendingDeletesCore.js` and drive
* the queue/timers with a fake clock, exactly like the node-half unit tests
* import `lib/handler.js`.
*
* Design (PLAN §5.5, re-based onto the pinned INTERFACE contract): deleting a
* session does NOT fire `/sm/delete` immediately. Instead the session row is
* hidden locally and an entry is parked here with a 10s deadline. While the
* window is open the entry is `pending` and undoable; when the deadline passes
* `fire()` invokes the injected host caller and the session is really moved to
* the recycle bin.
*
* Why module scope: the countdown must survive React unmounts and sidebar view
* switches (INTERFACE §1.2 step 3). The timers live in the module that owns a
* `PendingDeletes` instance, never in a component, so switching panels does not
* reset or drop the countdown.
*
* Contract note (deviation from a PLAN §5.5 suggestion, resolved toward the
* locked INTERFACE §0/§1.4): PLAN suggested a `beforeunload` flush that fires
* pending deletes on page exit. That directly contradicts the pinned behavior
* "刷新清空 client pending，该会话未被实际删除，仍在列表（数据安全）" —
* beforeunload also fires on refresh. The recycle bin move only EVER happens at
* the deadline, inside this module; a page refresh simply drops the in-memory
* queue and the host has not yet moved the file, so the session survives.
*
* Idempotency: `requestDelete` is a no-op when the id is already parked;
* `fire` re-checks presence before executing. Multi-session parallel parking
* is a natural Map property — one entry + one timer per id.
*/
/** The countdown window before a deletion becomes permanent (ms). P8: 10s → 5s. */
const UNDO_WINDOW_MS = 5e3;
/** How long a failed-fire entry stays visible in the rail (ms). */
const FAILED_RETAIN_MS = 6e3;
function createPendingDeletes(deps) {
	const now = deps.now ?? (() => Date.now());
	const schedule = deps.schedule ?? ((cb, delay) => {
		const t = setTimeout(cb, delay);
		return () => clearTimeout(t);
	});
	const onChange = deps.onChange ?? (() => {});
	const map = /* @__PURE__ */ new Map();
	/** One active timer per entry (allows parallel per-id windows). */
	const timers = /* @__PURE__ */ new Map();
	const listeners = /* @__PURE__ */ new Set();
	/**
	* Stable snapshot cache. `snapshot()` must return the SAME array reference
	* while the map is unchanged: a fresh array each call makes useSyncExternalStore
	* believe the store changed every render → React error #185 (Maximum update
	* depth exceeded) → the overlay root that reads it crashes on mount. We
	* rebuild the array once per mutation and return the cached reference until
	* the next mutation.
	*/
	let cached = null;
	const invalidateCache = () => {
		cached = null;
	};
	const notify = () => {
		onChange();
		for (const l of listeners) l();
	};
	/** Remove an entry and its timer. Returns the removed entry. */
	const drop = (id) => {
		const entry = map.get(id);
		timers.get(id)?.();
		timers.delete(id);
		map.delete(id);
		invalidateCache();
		return entry;
	};
	const park = (entry) => {
		map.set(entry.id, entry);
		invalidateCache();
		const cancel = schedule(() => {
			timers.delete(entry.id);
			fire(entry.id);
		}, Math.max(0, entry.deadline - now()));
		timers.set(entry.id, cancel);
	};
	/** Fire one entry: move it past its window by invoking the host. */
	async function fire(id) {
		if (!map.has(id)) return void 0;
		const entry = map.get(id);
		if (entry.state === "failed") return void 0;
		drop(id);
		let outcome;
		try {
			outcome = await deps.fire({
				id: entry.id,
				cwd: entry.cwd,
				title: entry.title
			});
		} catch (err) {
			outcome = {
				ok: false,
				code: String(err)
			};
		}
		if (!outcome.ok) {
			const failed = {
				id: entry.id,
				cwd: entry.cwd,
				title: entry.title,
				deadline: entry.deadline,
				state: "failed",
				error: outcome.code
			};
			map.set(failed.id, failed);
			invalidateCache();
			const cancel = schedule(() => {
				if (map.get(failed.id)?.state === "failed") {
					drop(failed.id);
					notify();
				}
			}, FAILED_RETAIN_MS);
			timers.set(failed.id, cancel);
			notify();
		}
		return outcome;
	}
	/** Immediately fire whatever is parked for id (test/edge hook). */
	async function fireNow(id) {
		if (!map.has(id)) return void 0;
		return fire(id);
	}
	return {
		requestDelete(id, cwd, title) {
			if (map.has(id)) return false;
			park({
				id,
				cwd,
				title,
				deadline: now() + UNDO_WINDOW_MS,
				state: "pending"
			});
			notify();
			return true;
		},
		undo(id) {
			const entry = map.get(id);
			if (!entry || entry.state !== "pending") return false;
			drop(id);
			notify();
			return true;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		snapshot: () => {
			if (cached === null) cached = Array.from(map.values());
			return cached;
		},
		get: (id) => map.get(id),
		isPending: (id) => map.get(id)?.state === "pending",
		fireNow
	};
}
//#endregion
export { FAILED_RETAIN_MS, UNDO_WINDOW_MS, createPendingDeletes };
