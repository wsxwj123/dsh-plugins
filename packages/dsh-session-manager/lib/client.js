window.__ModuleLoader__.load({
	id: "dsh-session-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");
		//#region src/client/bridgeCore.ts
		/**
		* POST one JSON RPC call and normalize every failure mode into a structured
		* `SmResult`. This function NEVER rejects:
		*   - transport/network errors  → `{ ok:false, code:'network-error' }` (I-5)
		*   - HTTP error status         → `{ ok:false, code:'http-<status>' }`
		*   - non-JSON success body     → `{ ok:false, code:'invalid-response' }`
		*   - 200 JSON body             → passed through untouched.
		* @param path - the full request path (e.g. `/sm/delete`).
		* @param body - JSON-serializable payload (`{}` when absent).
		* @param fetchImpl - platform fetch by default; tests inject a stub.
		*/
		async function postJson(path, body, fetchImpl = fetch) {
			let res;
			try {
				res = await fetchImpl(path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body ?? {})
				});
			} catch (err) {
				return {
					ok: false,
					code: "network-error",
					message: err instanceof Error ? err.message : String(err)
				};
			}
			if (!res.ok) return {
				ok: false,
				code: `http-${res.status}`,
				message: `request failed with status ${res.status}`
			};
			let json;
			try {
				json = await res.json();
			} catch {
				return {
					ok: false,
					code: "invalid-response",
					message: "host returned a non-JSON body"
				};
			}
			return json;
		}
		//#endregion
		//#region src/client/bridge.ts
		/**
		* client→host bridge: raw fetch over the same-origin `/sm/*` RPC surface.
		*
		* Wiring note (matches the node half's own decision, see src/handler.ts): the
		* `/sm` prefix route is a RAW HTTP JSON surface — it returns `{ ok:true, … }`
		* directly and accepts a raw `{ id, cwd, title }` body, guarded by the node
		* half's loopback trust fence. This file is the client's thin typed caller.
		*
		* Every call is a JSON POST (GET-free), so the browser sends `Sec-Fetch-Site`
		* same-origin and the loopback Host the node fence requires.
		*
		* All transport logic (including the review I-5 network-error catch) lives in
		* the pure, node-testable `bridgeCore`; this module only wires the `/sm` base
		* path to it.
		*/
		const BASE = "/sm";
		function post(path, body) {
			return postJson(BASE + path, body);
		}
		/**
		* Delete a session (recycle-bin move + optional archive-set cleanup). Fired
		* from the pending-delete state machine when the window expires.
		* @param id - session id.
		* @param cwd - working-directory path used to locate the project dir on the
		*   host. OMITTED when the session has no recorded cwd, so the host places it
		*   under `_no-cwd` (real DSH semantics) instead of returning `not-found` for
		*   an empty string. Pass `undefined`/omit to skip.
		* @param title - display title for the trash record (identify-in-trash only).
		* @param force - set true only when the user already confirmed at click time that
		*   a RUNNING session should be deleted (`byId.running === true`). The host no
		*   longer uses it to gate deletion (running is a client-side judgment), but it
		*   is still forwarded for compatibility. Omitted/false → a plain delete.
		*/
		function smDelete(id, cwd, title, force) {
			return post("/delete", {
				id,
				...cwd !== void 0 ? { cwd } : {},
				title,
				...force ? { force: true } : {}
			});
		}
		/** Remove a session id from the archive set (`unarchive`). */
		function smUnarchive(id) {
			return post("/unarchive", { id });
		}
		/** List the confirmed recycle-bin entries (debug/re-read only). */
		function smTrash() {
			return post("/trash", {});
		}
		/**
		* Empty the recycle bin. Requires an explicit `confirm:true` payload — the
		* client prompts a dialog before calling this (unrecoverable action).
		*/
		function smEmptyTrash(confirm) {
			return post("/emptyTrash", { confirm });
		}
		//#endregion
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
			const storage = deps.storage;
			const deletedIds = new Set(storage?.load() ?? []);
			const persistDeleted = () => {
				try {
					storage?.save(Array.from(deletedIds));
				} catch {}
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
			/** Fire one entry: move it past its window by invoking the host. A `force`
			*  captured at request time (the user confirmed a running session) is
			*  forwarded as `force:true`; otherwise the fire carries no force. */
			async function fire(id) {
				if (!map.has(id)) return void 0;
				const entry = map.get(id);
				if (entry.state === "failed" || entry.state === "cleanup") return void 0;
				drop(id);
				const outcome = await callFire({
					id: entry.id,
					cwd: entry.cwd,
					title: entry.title
				}, entry.force ? { force: true } : void 0);
				if (!outcome.ok) {
					if (outcome.moved === true) {
						deletedIds.add(entry.id);
						persistDeleted();
						map.set(entry.id, {
							...entry,
							state: "cleanup",
							error: outcome.code
						});
						invalidateCache();
						notify();
					} else {
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
				} else {
					deletedIds.add(entry.id);
					persistDeleted();
					notify();
				}
				return outcome;
			}
			/** Retry the archive cleanup of a `cleanup`-state entry. The file is already
			*  moved, so ANY retry outcome keeps the row hidden (the id stays in
			*  deletedIds); only `ok` drops the rail entry. A non-`ok` outcome keeps the
			*  entry retryable. Returns undefined when nothing is retryable (no cleanup
			*  entry / a retry is already in flight) so the UI treats it as a no-op. */
			async function retry(id) {
				const entry = map.get(id);
				if (!entry || entry.state !== "cleanup" || entry.retrying === true) return void 0;
				map.set(id, {
					...entry,
					retrying: true
				});
				invalidateCache();
				notify();
				const outcome = await callFire({
					id: entry.id,
					cwd: entry.cwd,
					title: entry.title
				}, entry.force ? { force: true } : void 0);
				const cur = map.get(id);
				if (!cur || cur.state !== "cleanup") return outcome;
				if (outcome.ok) {
					drop(id);
					notify();
				} else {
					map.set(id, {
						...cur,
						retrying: false,
						error: outcome.code
					});
					invalidateCache();
					notify();
				}
				return outcome;
			}
			/** Invoke the host delete, mapping a thrown host call to a failure. */
			async function callFire(entry, opts) {
				try {
					return await deps.fire(entry, opts);
				} catch (err) {
					return {
						ok: false,
						code: String(err)
					};
				}
			}
			/** Immediately fire whatever is parked for id (test/edge hook). */
			async function fireNow(id) {
				if (!map.has(id)) return void 0;
				return fire(id);
			}
			return {
				requestDelete(id, cwd, title, force) {
					const existing = map.get(id);
					if (existing !== void 0 && existing.state !== "failed") return false;
					if (existing !== void 0) drop(id);
					park({
						id,
						cwd,
						title,
						force: force === true ? true : void 0,
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
					if (deletedIds.delete(id)) persistDeleted();
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
				isDeleted: (id) => deletedIds.has(id),
				reconcileWithTrash(trashIds) {
					const live = new Set(trashIds);
					let changed = false;
					for (const id of deletedIds) if (!live.has(id)) {
						deletedIds.delete(id);
						changed = true;
					}
					if (!changed) return;
					persistDeleted();
					notify();
				},
				fireNow,
				retry
			};
		}
		//#endregion
		//#region src/client/pendingDeletes.ts
		/**
		* pendingDeletes — the module-scope deferred-deletion singleton browser plugins
		* drive. The pure state machine lives in `pendingDeletesCore.ts` (node-testable
		* separately); this module wires it to the real `/sm` bridge and re-exports the
		* core API + constants so the React UI imports everything from one place.
		*/
		/** localStorage key holding the confirmed-deleted session ids. */
		const DELETED_STORAGE_KEY = "dsh-sm.deleted";
		/**
		* The module singleton the UI drives. Wired to the real host bridge; the DOM
		* ride-along (row hide/show) is applied by the injection layer via a subscribe
		* that reconciles visibility from the park table + the persisted deleted set,
		* so nothing here touches the DOM.
		*/
		const pendingDeletes = createPendingDeletes({
			fire: (entry, opts) => smDelete(entry.id, entry.cwd, entry.title, opts?.force),
			onChange: () => {},
			storage: {
				load: () => {
					try {
						const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DELETED_STORAGE_KEY) : null;
						const arr = raw ? JSON.parse(raw) : [];
						return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
					} catch {
						return [];
					}
				},
				save: (ids) => {
					try {
						if (typeof localStorage !== "undefined") localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify(ids));
					} catch {}
				}
			}
		});
		//#endregion
		//#region src/client/sessionRowMatch.ts
		/**
		* sessionRowMatch — the pure, DOM-free core of row→session resolution.
		*
		* The official session row's ⋮ menu button carries
		* `aria-label = t("actions.session.aria", { name: title })`, i.e. a localized
		* string that contains the session's title verbatim (Chinese 「会话"X"的操作」 /
		* English "Session actions for X"). Given one such label and the `byId` map, we
		* find the session whose title is contained in the label, preferring the
		* LONGEST contained title (most specific — avoids a short title matching a
		* longer one by accident).
		*
		* The byId summary has BOTH a raw `title` (present only when the session has
		* one) and a derived `displayTitle` (always present, equals `title` for a
		* titled session). We match against `title ?? displayTitle` so either field
		* works regardless of which the runtime carries.
		*
		* Same-title ties (review I-6): DSH does not guarantee unique titles, so two
		* sessions can render IDENTICAL labels. A per-row match is then ambiguous and
		* must not silently pick the first byId key — that would bind BOTH rows'
		* delete buttons to one session (删错目录). The container-level `resolveRows`
		* resolves ties by aligning DOM row order with the ordered id list: the k-th
		* row whose label resolves to a shared title binds the k-th same-title id, so
		* every row gets a DISTINCT id and never another row's session.
		*
		* Kept in its own module so a node unit test can drive it directly (mirrors
		* pendingDeletesCore): no DOM, no react.
		*/
		/** The longest non-blank title contained in the label (per-row primitive). */
		function bestTitleIn(label, byId) {
			let best = null;
			for (const id of Object.keys(byId)) {
				const s = byId[id];
				if (!s || s.blank) continue;
				const candidate = s.title ?? s.displayTitle ?? "";
				if (!candidate) continue;
				if (candidate.length === 0 || candidate.length > 256) continue;
				if (!label.includes(candidate)) continue;
				if (best === null || candidate.length > best.length) best = candidate;
			}
			return best;
		}
		/**
		* Resolve ids for a WHOLE container's rows in DOM order, disambiguating
		* same-title ties by aligning row order with the ordered id list (review I-6).
		*
		* For each row this finds the longest title contained in its label (identical
		* to `matchSessionFromLabel`). When SEVERAL rows share a title, per-row
		* matching is ambiguous; the official list renders rows in `ids` order, so the
		* k-th such row (in DOM order) binds the k-th same-title id (in `ids` order).
		* This guarantees every row binds a DISTINCT id — a row's delete button can
		* never point at another row's session, and `rowById` keys never collide.
		*
		* @param labels - one aria-label per row, in DOM order (null → unmatchable row).
		* @param byId - session summary map.
		* @param ids - ordered session id list (the tie-order source of truth).
		* @returns one MatchedSession per row; null when the row cannot be matched
		*   (no title / blank / overflow beyond the same-title id group).
		*/
		function resolveRows(labels, byId, ids) {
			const rowTitle = labels.map((label) => label === null ? null : bestTitleIn(label, byId));
			const idsByTitle = /* @__PURE__ */ new Map();
			for (const id of ids) {
				const s = byId[id];
				if (!s || s.blank) continue;
				const title = s.title ?? s.displayTitle ?? "";
				if (!title || title.length === 0 || title.length > 256) continue;
				const group = idsByTitle.get(title);
				if (group) group.push(id);
				else idsByTitle.set(title, [id]);
			}
			const consumed = /* @__PURE__ */ new Map();
			return rowTitle.map((title) => {
				if (title === null) return null;
				const group = idsByTitle.get(title);
				if (!group) return null;
				const index = consumed.get(title) ?? 0;
				consumed.set(title, index + 1);
				const id = group[index];
				if (id === void 0) return null;
				const s = byId[id];
				if (!s) return null;
				return {
					id,
					cwd: s.cwd,
					title,
					running: s.running === true
				};
			});
		}
		//#endregion
		//#region src/client/icons.ts
		/**
		* icons — inline 16x16 stroke SVGs (Lucide-style) used instead of emoji, so the
		* delete and archive buttons match DSH's official icon footprint. `currentColor`
		* lets the button's CSS `color` drive the tint (official palette: label-tertiary
		* resting, label-primary on hover). Zero dependencies, no @deepseek-ai imports,
		* so the client-bundle purity gate is unaffected.
		*/
		/** Trashcan (delete). */
		const TRASH_SVG = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M3 6h18\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/><path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/><line x1=\"10\" y1=\"11\" x2=\"10\" y2=\"17\"/><line x1=\"14\" y1=\"11\" x2=\"14\" y2=\"17\"/></svg>";
		/** Archive box. */
		const ARCHIVE_SVG = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\" focusable=\"false\"><rect width=\"20\" height=\"5\" x=\"2\" y=\"3\" rx=\"1\"/><path d=\"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8\"/><path d=\"M10 12h4\"/></svg>";
		//#endregion
		//#region \0dsh-css:src/client/rail.module.css.mjs
		const css = ".FPsCja_rail{z-index:2147483000;border:1px solid var(--dsw-alias-border-l2,#8080804d);background:var(--dsw-alias-bg-overlay,#18181cf5);max-width:min(520px,100vw - 24px);box-shadow:var(--dsw-shadow-lv3,0 8px 28px #0006);color:var(--dsw-alias-label-primary,#e8e8ec);font-family:var(--dsw-font-body,system-ui, sans-serif);pointer-events:auto;border-radius:12px;flex-direction:column;align-items:stretch;gap:6px;padding:8px 10px;font-size:13px;line-height:1.4;animation:.16s ease-out FPsCja_rail-in;display:flex;position:fixed;top:12px;left:50%;transform:translate(-50%)}@keyframes FPsCja_rail-in{0%{opacity:0;transform:translate(-50%)translateY(8px)}to{opacity:1;transform:translate(-50%)translateY(0)}}.FPsCja_item{flex-direction:row;align-items:center;gap:10px;max-width:100%;display:flex}.FPsCja_label{flex-direction:column;min-width:0;display:flex}.FPsCja_title{text-overflow:ellipsis;white-space:nowrap;max-width:200px;font-size:13px;font-weight:500;overflow:hidden}.FPsCja_countdown,.FPsCja_add{color:var(--dsw-alias-label-tertiary,#c8c8d29e);font-size:11px}.FPsCja_undo{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-button-elevated-fill,#ffffff0f);color:var(--dsw-alias-state-business-primary,#4f8cff);border-radius:8px;flex:none;padding:4px 10px;font-family:inherit;font-size:12px;font-weight:500}.FPsCja_undo:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff1a)}.FPsCja_failed{color:var(--dsw-alias-state-error-primary,#ff6b6b);text-align:left;background:0 0;border:none;min-width:0;font-family:inherit;font-size:13px}.FPsCja_dismiss{cursor:pointer;color:var(--dsw-alias-label-tertiary,#c8c8d29e);background:0 0;border:none;border-radius:6px;flex:none;padding:2px 4px;font-family:inherit;font-size:16px;line-height:1}.FPsCja_dismiss:hover{color:var(--dsw-alias-label-primary,#e8e8ec)}.FPsCja_divider{background:var(--dsw-alias-border-l2,#80808040);flex:none;width:100%;height:1px}.FPsCja_deleteBtn{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary,#c8c8d299);opacity:.85;background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.FPsCja_deleteBtn:hover{color:var(--dsw-alias-label-primary,#e8e8ec);background:var(--dsw-alias-interactive-bg-hover,#ffffff1a);opacity:1}.FPsCja_deleteBtn svg{width:16px;height:16px;display:block}.FPsCja_entryButton{cursor:pointer;color:var(--dsw-alias-label-secondary,#e6e6ecd1);font-family:var(--dsw-font-body,system-ui, sans-serif);background:0 0;border:none;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:6px 10px;font-size:14px;line-height:20px;display:inline-flex}.FPsCja_entryButton:hover{color:var(--dsw-alias-label-primary,#e8e8ec);background:var(--dsw-alias-interactive-bg-hover,#ffffff14)}.FPsCja_overlay{z-index:2147482000;border:1px solid var(--dsw-alias-border-l2,#8080804d);background:var(--dsw-alias-bg-overlay,#18181cfa);width:min(360px,100vw - 24px);max-height:min(480px,100vh - 120px);box-shadow:var(--dsw-shadow-lv3,0 8px 28px #0006);color:var(--dsw-alias-label-primary,#e8e8ec);font-family:var(--dsw-font-body,system-ui, sans-serif);pointer-events:auto;border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:56px;left:12px;overflow:hidden}.FPsCja_backdrop{z-index:2147481999;pointer-events:auto;background:#0000002e;position:fixed;inset:0}.FPsCja_head{border-bottom:1px solid var(--dsw-alias-border-l2,#80808038);justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;font-size:14px;font-weight:600;display:flex}.FPsCja_close{cursor:pointer;color:var(--dsw-alias-label-tertiary,#c8c8d29e);background:0 0;border:none;border-radius:6px;padding:2px 6px;font-family:inherit;font-size:16px;line-height:1}.FPsCja_close:hover{color:var(--dsw-alias-label-primary,#e8e8ec);background:var(--dsw-alias-interactive-bg-hover,#ffffff14)}.FPsCja_list{flex-direction:column;min-height:0;padding:4px;display:flex;overflow-y:auto}.FPsCja_row{border-radius:8px;align-items:center;gap:8px;padding:7px 8px;display:flex}.FPsCja_row:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff0f)}.FPsCja_rowTitle{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-size:13px;overflow:hidden}.FPsCja_action{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-button-elevated-fill,#ffffff0d);color:var(--dsw-alias-label-secondary,#e6e6ecd1);border-radius:7px;flex:none;padding:3px 9px;font-family:inherit;font-size:12px}.FPsCja_action:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff17);color:var(--dsw-alias-label-primary,#e8e8ec)}.FPsCja_danger{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-button-elevated-fill,#ffffff0d);color:var(--dsw-alias-state-error-primary,#ff6b6b);border-radius:7px;flex:none;padding:3px 9px;font-family:inherit;font-size:12px}.FPsCja_danger:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff17);color:var(--dsw-alias-state-error-primary,#ff6b6b)}.FPsCja_empty{text-align:center;color:var(--dsw-alias-label-tertiary,#c8c8d29e);padding:20px 14px;font-size:13px}.FPsCja_errorBanner{color:var(--dsw-alias-state-error-primary,#ff6b6b);border-bottom:1px solid var(--dsw-alias-border-l2,#80808038);padding:8px 12px;font-size:12px}.FPsCja_trashBar{border-top:1px solid var(--dsw-alias-border-l2,#80808038);align-items:center;gap:10px;padding:8px 12px;display:flex}.FPsCja_trashButton{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-button-elevated-fill,#ffffff0d);color:var(--dsw-alias-state-error-primary,#ff6b6b);border-radius:7px;flex:none;padding:4px 11px;font-family:inherit;font-size:12px}.FPsCja_trashButton:disabled{cursor:default;opacity:.45;color:var(--dsw-alias-label-tertiary,#c8c8d299)}.FPsCja_trashCount{color:var(--dsw-alias-label-tertiary,#c8c8d29e);text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:12px;overflow:hidden}";
		const tagId = "dsh-session-manager/rail.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-session-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var rail_module_css_default = {
			"item": "FPsCja_item",
			"rail-in": "FPsCja_rail-in",
			"countdown": "FPsCja_countdown",
			"failed": "FPsCja_failed",
			"backdrop": "FPsCja_backdrop",
			"head": "FPsCja_head",
			"rail": "FPsCja_rail",
			"entryButton": "FPsCja_entryButton",
			"overlay": "FPsCja_overlay",
			"errorBanner": "FPsCja_errorBanner",
			"divider": "FPsCja_divider",
			"row": "FPsCja_row",
			"add": "FPsCja_add",
			"trashButton": "FPsCja_trashButton",
			"action": "FPsCja_action",
			"title": "FPsCja_title",
			"empty": "FPsCja_empty",
			"undo": "FPsCja_undo",
			"deleteBtn": "FPsCja_deleteBtn",
			"close": "FPsCja_close",
			"rowTitle": "FPsCja_rowTitle",
			"danger": "FPsCja_danger",
			"dismiss": "FPsCja_dismiss",
			"trashBar": "FPsCja_trashBar",
			"trashCount": "FPsCja_trashCount",
			"label": "FPsCja_label",
			"list": "FPsCja_list"
		};
		//#endregion
		//#region src/client/DeleteButton.tsx
		/** Any tree role (the sidebar session list); we scan all present to be safe.
		*  No aria-label — that attribute is a localized label, not a stable marker. */
		const SESSIONS_LIST_SEL = "[role=\"tree\"]";
		/** Global hover rule injected once; targets official rows by role, not hashed classes. */
		const HOVER_CSS = `[role="treeitem"]:hover > [data-dsh-sm-delete] { display: inline-flex !important; }`;
		/** The injected delete button's attribute (also its skip/injection marker). */
		const DELETE_BTN_SEL = "[data-dsh-sm-delete]";
		/**
		* The row's official ⋮-menu aria-label: the ONE labelled button that is NOT
		* our injected delete control. Project rows carry TWO other labelled buttons
		* (workspace menu + new-session) and blank (New Session) rows carry none, so
		* both return null and are skipped — a locale-independent discriminator that
		* also keeps us off the hashed class names. Excluding `[data-dsh-sm-delete]`
		* keeps re-syncs (React node reuse) resolvable.
		*/
		function rowLabel(row) {
			const buttons = Array.from(row.querySelectorAll("button[aria-label]")).filter((b) => !b.hasAttribute("data-dsh-sm-delete"));
			if (buttons.length !== 1) return null;
			const label = buttons[0].getAttribute("aria-label");
			return label && label.trim().length > 0 ? label : null;
		}
		/**
		* Build the injection controller bound to one client `apply(ctx)`.
		* @param getContext - provides the client context (sessions list snapshot).
		* @param onDelete - called when a delete button is clicked; the caller hides
		*   the row and parks the deferred deletion.
		*/
		function createDeleteController(getContext, onDelete) {
			const rowById = /* @__PURE__ */ new Map();
			if (!document.head.querySelector("#dsh-session-manager-delete-hover")) {
				const style = document.createElement("style");
				style.id = "dsh-session-manager-delete-hover";
				style.textContent = HOVER_CSS;
				document.head.appendChild(style);
			}
			const injectIntoRow = (row, action) => {
				if (row.querySelector(DELETE_BTN_SEL) !== null) return;
				rowById.set(action.id, row);
				const btn = document.createElement("button");
				btn.type = "button";
				btn.dataset.dshSmDelete = "true";
				btn.className = rail_module_css_default.deleteBtn;
				btn.title = action.running ? "删除会话（会话正在运行任务，将提示确认）" : "删除会话";
				btn.setAttribute("aria-label", `删除会话 ${action.title}`);
				btn.innerHTML = TRASH_SVG;
				btn.style.display = "none";
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					const s = getContext().sessions.list.getSnapshot().byId[action.id];
					const running = s ? s.running === true : action.running;
					onDelete({
						id: action.id,
						cwd: s?.cwd ?? action.cwd,
						title: action.title,
						running
					}, row);
				});
				row.appendChild(btn);
			};
			const sync = () => {
				for (const [id, el] of Array.from(rowById.entries())) if (!el.isConnected) rowById.delete(id);
				const snapshot = getContext().sessions.list.getSnapshot();
				const byId = snapshot.byId;
				const ids = snapshot.ids;
				for (const container of document.querySelectorAll(SESSIONS_LIST_SEL)) {
					const rows = Array.from(container.querySelectorAll(":scope [role=\"treeitem\"]"));
					const labels = rows.map(rowLabel);
					const actions = resolveRows(labels, byId, ids);
					rows.forEach((row, i) => {
						const action = actions[i];
						if (!action) {
							if (labels[i] !== null) console.debug("[dsh-session-manager] session row not resolvable:", {
								ariaLabel: labels[i],
								byIdCount: Object.keys(byId).length,
								byIdTitles: Object.keys(byId).map((k) => byId[k]?.title ?? byId[k]?.displayTitle)
							});
							return;
						}
						injectIntoRow(row, action);
					});
				}
			};
			/**
			* Release everything this controller injected (review I-7): every delete
			* button (removing the node also drops its click listener — no dangling
			* closures over the old ctx), the injected hover `<style>`, and the row map.
			* Called from the client effect cleanup AFTER the MutationObserver and list
			* subscription are disconnected, so the removals cannot re-trigger sync().
			* A later re-apply recreates the style and buttons from scratch.
			*/
			const dispose = () => {
				document.querySelectorAll(DELETE_BTN_SEL).forEach((el) => el.remove());
				document.querySelectorAll("#dsh-session-manager-delete-hover").forEach((el) => el.remove());
				rowById.clear();
			};
			return {
				sync,
				rowById,
				dispose
			};
		}
		//#endregion
		//#region src/client/UndoRail.tsx
		/**
		* UndoRail — the fixed bottom overlay that surfaces deferred deletions.
		*
		* Reads the module-scope `pendingDeletes` park table through
		* `useSyncExternalStore`, so the rail re-mounts anywhere (it is appended to
		* `document.body`, never unmounted on view switch) and always reflects the
		* same module state the countdown timers live in — switching panels neither
		* resets nor drops a countdown (INTERFACE §1.2 step 3).
		*
		* Three entry kinds:
		*   - pending (undoable): title + seconds remaining, with an Undo button.
		*   - failed (retain window): an error readout; the session is already
		*     re-shown. Failed entries are auto-cleared by the state machine after
		*     a short window, so no manual dismissal is needed here.
		*   - cleanup (partial failure, review I-3): the file was moved but archive
		*     cleanup is incomplete — the row stays hidden and a Retry button
		*     re-invokes the host delete to complete it (INTERFACE §2.4).
		*/
		const getSnapshot = () => pendingDeletes.snapshot();
		const subscribe = (listener) => pendingDeletes.subscribe(listener);
		/** Countdown tick cadence: re-renders the rail so `Date.now()`-derived seconds refresh. */
		const TICK_MS = 500;
		/** One entry row. `now` is passed by the parent tick so all rows share a clock. */
		function EntryRow({ entry, now }) {
			if (entry.state === "failed") return (0, react.createElement)("div", { className: rail_module_css_default.item }, (0, react.createElement)("span", {
				className: rail_module_css_default.failed,
				title: entry.error ? `删除失败：${entry.error}` : "删除失败"
			}, `「${entry.title}」删除失败，已恢复`));
			if (entry.state === "cleanup") return (0, react.createElement)("div", { className: rail_module_css_default.item }, (0, react.createElement)("span", {
				className: rail_module_css_default.failed,
				title: entry.error ? `清理未完成：${entry.error}` : "清理未完成"
			}, `「${entry.title}」清理未完成，可重试补齐`), (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.undo,
				disabled: entry.retrying === true,
				onClick: () => {
					pendingDeletes.retry(entry.id);
				}
			}, entry.retrying === true ? "重试中…" : "重试"));
			const remaining = Math.max(0, Math.ceil((entry.deadline - now) / 1e3));
			return (0, react.createElement)("div", {
				className: rail_module_css_default.item,
				style: { gap: 10 }
			}, (0, react.createElement)("div", { className: rail_module_css_default.label }, (0, react.createElement)("div", { className: rail_module_css_default.title }, entry.title), (0, react.createElement)("div", { className: rail_module_css_default.countdown }, `撤销删除（${remaining}秒）`)), (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.undo,
				onClick: () => {
					if (!pendingDeletes.undo(entry.id)) window.alert("该删除已生效，无法撤销");
				}
			}, "撤销"));
		}
		function UndoRail() {
			const entries = (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
			const [, setTick] = (0, react.useState)(0);
			(0, react.useEffect)(() => {
				if (entries.length === 0) return;
				const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
				return () => clearInterval(id);
			}, [entries.length]);
			if (entries.length === 0) return null;
			const now = Date.now();
			const items = entries.flatMap((entry, i) => {
				const row = (0, react.createElement)(EntryRow, {
					entry,
					now,
					key: "row-" + entry.id
				});
				if (i === 0) return [row];
				return [(0, react.createElement)("div", {
					key: "div-" + entry.id,
					className: rail_module_css_default.divider
				}), row];
			});
			return (0, react.createElement)("div", {
				className: rail_module_css_default.rail,
				role: "status"
			}, items);
		}
		//#endregion
		//#region src/client/archiveState.ts
		/**
		* archiveState — a tiny module-scope observable for the archive overlay's open
		* flag. The entry button (inside the sidebar.footer.action slot) and the
		* overlay (a body-append root) are different React roots; sharing one module
		* store lets the button toggle the overlay without threading props across
		* several mount points.
		*/
		const listeners = /* @__PURE__ */ new Set();
		let open = false;
		function notify() {
			for (const l of listeners) l();
		}
		function getArchiveOpen() {
			return open;
		}
		function setArchiveOpen(v) {
			if (open === v) return;
			open = v;
			notify();
		}
		function subscribeArchive(fn) {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
			};
		}
		//#endregion
		//#region src/client/ArchiveEntry.tsx
		/**
		* ArchiveEntry — the 「归档」 button contributed to the `sidebar.footer.action`
		* list slot, beside Settings at the sidebar foot. Toggles the archive overlay.
		*
		* Props: `{ wide: boolean }` (the owner share declared by ui-sidebar). In the
		* 56px rail the label is dropped and only the icon shows — behavior identical.
		*/
		const getOpen = () => getArchiveOpen();
		const sub = (l) => subscribeArchive(l);
		/**
		* Toggle the archive overlay. The icon is a static, trusted inline SVG (no user
		* input concatenated), tinted via currentColor so it matches the footer action
		* palette.
		*/
		function ArchiveEntry({ ctx, wide }) {
			const open = (0, react.useSyncExternalStore)(sub, getOpen, getOpen);
			return (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.entryButton,
				"aria-pressed": open,
				"aria-label": "归档",
				onClick: () => setArchiveOpen(!open),
				title: "归档"
			}, (0, react.createElement)("span", {
				"aria-hidden": true,
				dangerouslySetInnerHTML: { __html: ARCHIVE_SVG }
			}), wide ? (0, react.createElement)("span", null, "归档") : null);
		}
		//#endregion
		//#region src/client/ArchiveView.tsx
		/**
		* ArchiveView — the overlay listing archived sessions, opened by the footer
		* 「归档」 entry. Each row offers 「取消归档」 and 「删除」.
		*
		* Data (INTERFACE §2.2/§2.5): archived rows = `workspaces.list.archivedSessionIds`
		* ∩ `sessions.list.byId` (metadata persists in byId even though the official
		* list filters them out visually). Dangling ids (byId gone) are hidden, never
		* rendered as ghosts.
		*
		* Delete of an archived session rides the same recycle-bin/undo flow as a
		* normal-list deletion (host does the two-step move + archive-set cleanup).
		* Rows whose id is currently parked for deletion are hidden from this list;
		* a failed fire un-parks them and they reappear.
		*/
		const selectPending = () => pendingDeletes.snapshot();
		const subscribePending = (l) => pendingDeletes.subscribe(l);
		const selectOpen = () => getArchiveOpen();
		const subscribeOpen = (l) => subscribeArchive(l);
		function ArchiveView({ ctx, sessionsFeed, workspacesFeed }) {
			const open = (0, react.useSyncExternalStore)(subscribeOpen, selectOpen, selectOpen);
			const pending = (0, react.useSyncExternalStore)(subscribePending, selectPending, selectPending);
			const sessionsSnap = (0, react.useSyncExternalStore)((l) => sessionsFeed.subscribe(l), () => sessionsFeed.getSnapshot(), () => sessionsFeed.getSnapshot());
			const workspacesSnap = (0, react.useSyncExternalStore)((l) => workspacesFeed.subscribe(l), () => workspacesFeed.getSnapshot(), () => workspacesFeed.getSnapshot());
			const [trashCount, setTrashCount] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				let cancelled = false;
				smTrash().then((res) => {
					if (cancelled) return;
					if (res.ok) {
						setTrashCount(Array.isArray(res.items) ? res.items.length : 0);
						if (Array.isArray(res.items)) pendingDeletes.reconcileWithTrash(res.items.map((i) => i.id).filter((id) => typeof id === "string"));
					} else setError(`读取回收站失败：${res.code ?? res.message ?? "unknown"}`);
				}).catch((err) => {
					if (!cancelled) setError(`读取回收站失败：${err instanceof Error ? err.message : String(err)}`);
				});
				return () => {
					cancelled = true;
				};
			}, [open]);
			if (!open) return null;
			/** Confirm-then-empty the recycle bin (unrecoverable) — defined in-component
			*  so it captures the trash state setters. `window.confirm` is a genuine
			*  modal; we call /sm/emptyTrash with confirm:true on confirmation. Failures
			*  are surfaced, never swallowed; the count is re-read so the UI re-syncs.
			*  The try/catch guarantees no await-site rejection escapes as unhandled
			*  (I-5). */
			const onEmptyTrash = async (count) => {
				if (!window.confirm(`将永久删除回收站中的 ${count} 个会话，此操作不可撤销。确定继续？`)) return;
				try {
					const res = await smEmptyTrash(true);
					if (!res.ok) {
						setError(`清空回收站失败：${res.code ?? res.message ?? "unknown"}`);
						return;
					}
					setError(null);
					const t = await smTrash();
					if (t.ok) {
						setTrashCount(Array.isArray(t.items) ? t.items.length : 0);
						if (Array.isArray(t.items)) pendingDeletes.reconcileWithTrash(t.items.map((i) => i.id).filter((id) => typeof id === "string"));
					} else setError(`读取回收站失败：${t.code ?? t.message ?? "unknown"}`);
				} catch (err) {
					setError(`清空回收站失败：${err instanceof Error ? err.message : String(err)}`);
				}
			};
			/** Remove a session id from the archive set via /sm/unarchive. Failures are
			*  surfaced on the error banner (never silently logged away — I-5) and we
			*  fall back to a host re-pull (PLAN §5.1 risk 4 sub-state B) so a missed
			*  broadcast still converges. The row stays visible. */
			const onUnarchive = async (id) => {
				try {
					const res = await smUnarchive(id);
					if (!res.ok) {
						setError(`取消归档失败：${res.code ?? res.message ?? "unknown"}`);
						ctx.workspaces.refresh();
					}
				} catch (err) {
					setError(`取消归档失败：${err instanceof Error ? err.message : String(err)}`);
				}
			};
			const byId = sessionsSnap.byId;
			const parked = new Set(pending.filter((e) => e.state === "pending").map((e) => e.id));
			const rows = [];
			for (const id of workspacesSnap.archivedSessionIds) {
				const s = byId[id];
				if (!s || s.blank) continue;
				if (parked.has(id) || pendingDeletes.isDeleted(id)) continue;
				rows.push({
					...s,
					id
				});
			}
			let body;
			if (rows.length === 0) body = (0, react.createElement)("div", { className: rail_module_css_default.empty }, "暂无归档会话");
			else body = (0, react.createElement)("div", { className: rail_module_css_default.list }, rows.map((row) => (0, react.createElement)("div", {
				key: row.id,
				className: rail_module_css_default.row
			}, (0, react.createElement)("div", { className: rail_module_css_default.rowTitle }, row.title ?? row.displayTitle), (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.action,
				onClick: () => void onUnarchive(row.id)
			}, "取消归档"), (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.danger,
				onClick: () => requestArchivedDelete(ctx, row)
			}, "删除"))));
			const canEmpty = trashCount !== null && trashCount > 0;
			const countLabel = trashCount === null ? "回收站：未知" : trashCount > 0 ? `${trashCount} 个已删除会话` : "回收站为空";
			const trashBar = (0, react.createElement)("div", { className: rail_module_css_default.trashBar }, (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.trashButton,
				disabled: !canEmpty,
				title: canEmpty ? `永久删除回收站中的 ${trashCount} 个会话` : "回收站为空",
				onClick: () => {
					onEmptyTrash(canEmpty ? trashCount : 0);
				}
			}, "清空回收站"), (0, react.createElement)("span", { className: rail_module_css_default.trashCount }, countLabel));
			return (0, react.createElement)(react.Fragment, null, (0, react.createElement)("div", {
				className: rail_module_css_default.backdrop,
				"aria-hidden": true,
				onClick: () => setArchiveOpen(false)
			}), (0, react.createElement)("div", {
				className: rail_module_css_default.overlay,
				role: "dialog",
				"aria-label": "归档会话"
			}, (0, react.createElement)("div", { className: rail_module_css_default.head }, (0, react.createElement)("span", null, "归档"), (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.close,
				"aria-label": "关闭归档视图",
				onClick: () => setArchiveOpen(false)
			}, "✕")), error && (0, react.createElement)("div", {
				className: rail_module_css_default.errorBanner,
				role: "alert"
			}, error), body, trashBar));
		}
		/** Park a deferred delete for an archived session (host two-step on fire).
		*  Multi-entry allowed (P9); a false return only means the id is already parked. */
		function requestArchivedDelete(_ctx, row) {
			const label = row.title ?? row.displayTitle;
			pendingDeletes.requestDelete(row.id, row.cwd, label);
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Client half of dsh-session-manager.
		*
		* Responsibilities (PLAN §4 T4/T5):
		*   1. DOM-inject a hover-revealed delete button into every session row and
		*      reconcile row visibility against the module-scope deferred-delete queue.
		*   2. Mount a fixed UndoRail overlay that survives view/panel switches.
		*   3. Register a `sidebar.footer.action` entry (「归档」) and mount the archive
		*      overlay it opens.
		*   4. Clear the current selection when the selected session is deleted
		*      (INTERFACE §1.4 / A-5).
		*
		* Cordis access discipline: every service read is covered by `export const
		* inject` (sessions/workspaces/slots). No bare read of an un-declared service.
		*/
		/** Services required before mounting (provided by the client runtime). */
		const inject = [
			"sessions",
			"workspaces",
			"slots"
		];
		/** The footer action list-cell id (PLAN §9.3: additive, unique). */
		const FOOTER_ACTION_ID = "dsh-session-manager";
		/**
		* Error boundary over the fixed overlays. A render crash (e.g. an archive-view
		* subscription/field mismatch) must NOT silently do nothing — it logs the
		* stack and shows a dismissible strip instead of blanking the undo rail.
		*/
		var OverlayBoundary = class extends react.Component {
			state = { error: null };
			static getDerivedStateFromError(error) {
				return { error: error instanceof Error ? error.message : String(error) };
			}
			componentDidCatch(error, info) {
				console.error("[dsh-session-manager] overlay render crash:", error, info);
			}
			render() {
				if (this.state.error !== null) return (0, react.createElement)("div", { style: {
					position: "absolute",
					left: 12,
					bottom: 110,
					zIndex: 2147483e3,
					padding: "8px 12px",
					borderRadius: 10,
					background: "rgba(120,20,20,.94)",
					color: "#ffd9d9",
					font: "12px/1.5 ui-monospace,Menlo,monospace",
					pointerEvents: "auto",
					maxWidth: 340
				} }, `dsh-session-manager UI 异常：${this.state.error}`, (0, react.createElement)("button", {
					type: "button",
					onClick: () => this.setState({ error: null }),
					style: {
						marginLeft: 8,
						border: "none",
						background: "none",
						color: "#ffd9d9",
						cursor: "pointer"
					}
				}, "重试"));
				return this.props.children;
			}
		};
		function apply(ctx) {
			const disposeSlot = ctx.slots.register({
				name: "sidebar.footer.action",
				id: FOOTER_ACTION_ID,
				order: 1e3
			}, (props) => (0, react.createElement)(ArchiveEntry, {
				ctx,
				wide: props.wide
			}));
			const controller = createDeleteController(() => ctx, (action, row) => {
				let force;
				if (action.running === true) {
					if (!window.confirm(`「${action.title}」会话正在运行任务，确认删除？（文件将移入回收站）`)) return;
					force = true;
				}
				const parked = pendingDeletes.requestDelete(action.id, action.cwd, action.title, force);
				console.debug("[dsh-session-manager] delete click -> requestDelete=", parked, "id=", action.id, "cwd=", action.cwd, "running=", action.running, "force=", force);
			});
			/** Hide/restore rows whose ids are parked vs active in the park table.
			*  `rowById` is maintained by the injection controller (each injected button
			*  records the row keyed by session id), so a row re-created after a group
			*  re-render is re-injected — and therefore re-hidden — on the next sync. */
			const reconcileVisibility = () => {
				for (const [id, row] of controller.rowById.entries()) {
					if (!row.isConnected) continue;
					const hide = pendingDeletes.get(id)?.state === "pending" || pendingDeletes.isDeleted(id);
					const current = row.style.display;
					if (hide && current !== "none") row.style.display = "none";
					if (!hide && current === "none") row.style.display = "";
				}
			};
			/** Clear selection once the CURRENT session's delete has CONFIRMED on the
			*  host (fire-success), restoring the default New-Session view. This also
			*  covers an open-but-idle session removed by a force-delete. We do NOT yank
			*  the user off the session during the undoable/confirm window — only on
			*  confirmed deletion (so an un-confirmed / undone delete keeps them on it). */
			const reconcileSelection = () => {
				const current = ctx.sessions.list.getSnapshot().current;
				if (current === void 0) return;
				if (pendingDeletes.isDeleted(current)) ctx.sessions.clear();
			};
			const offPending = pendingDeletes.subscribe(() => {
				reconcileVisibility();
				reconcileSelection();
			});
			smTrash().then((res) => {
				if (res.ok && Array.isArray(res.items)) pendingDeletes.reconcileWithTrash(res.items.map((item) => item.id).filter((id) => typeof id === "string"));
			});
			const offList = ctx.sessions.list.subscribe(() => controller.sync());
			const sync = () => {
				controller.sync();
				reconcileVisibility();
			};
			const mo = new MutationObserver(sync);
			mo.observe(document.body, {
				childList: true,
				subtree: true
			});
			const mount = document.createElement("div");
			mount.setAttribute("data-dsh-session-manager-overlays", "true");
			mount.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:2147483000";
			document.body.appendChild(mount);
			const overlays = (0, react_dom_client.createRoot)(mount);
			overlays.render((0, react.createElement)("div", { style: { pointerEvents: "none" } }, (0, react.createElement)(OverlayBoundary, null, (0, react.createElement)(UndoRail), (0, react.createElement)(ArchiveView, {
				ctx,
				sessionsFeed: ctx.sessions.list,
				workspacesFeed: ctx.workspaces.list
			}))));
			sync();
			ctx.effect(() => () => {
				disposeSlot();
				offPending();
				offList();
				mo.disconnect();
				controller.dispose();
				overlays.unmount();
				mount.remove();
			}, "dsh-session-manager: client lifecycle");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
