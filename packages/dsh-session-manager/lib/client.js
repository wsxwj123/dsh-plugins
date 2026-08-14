window.__ModuleLoader__.load({
	id: "dsh-session-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");
		//#region src/client/bridge.ts
		const BASE = "/sm";
		async function post(path, body) {
			const res = await fetch(BASE + path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body ?? {})
			});
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
		/**
		* Delete a session (recycle-bin move + optional archive-set cleanup). Fired
		* from the pending-delete state machine when the 10s window expires.
		* @param id - session id.
		* @param cwd - cwd label used to locate the project dir on the host.
		* @param title - display title for the trash record (identify-in-trash only).
		*/
		function smDelete(id, cwd, title) {
			return post("/delete", {
				id,
				cwd,
				title
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
		/** The countdown window before a deletion becomes permanent (ms). */
		const UNDO_WINDOW_MS = 1e4;
		/** How long a failed-fire entry stays visible in the rail (ms). */
		const FAILED_RETAIN_MS = 6e3;
		/** Map values in insertion (request) order. */
		function toEntries(map) {
			return Array.from(map.values());
		}
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
				return entry;
			};
			const park = (entry) => {
				map.set(entry.id, entry);
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
					if (map.has(id)) return;
					park({
						id,
						cwd,
						title,
						deadline: now() + UNDO_WINDOW_MS,
						state: "pending"
					});
					notify();
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
				snapshot: () => toEntries(map),
				get: (id) => map.get(id),
				isPending: (id) => map.get(id)?.state === "pending",
				fireNow
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
		/**
		* The module singleton the UI drives. Wired to the real host bridge; the DOM
		* ride-along (row hide/show) is applied by the injection layer via a subscribe
		* that reconciles visibility from the park table, so nothing here touches the
		* DOM.
		*/
		const pendingDeletes = createPendingDeletes({
			fire: (entry) => smDelete(entry.id, entry.cwd, entry.title),
			onChange: () => {}
		});
		//#endregion
		//#region src/client/DeleteButton.tsx
		const SESSIONS_LIST_SEL = "div[role=\"tree\"][aria-label=\"sessions\"]";
		/** Resolve the session id a tree row maps to (title reverse-lookup + blank). */
		function resolveRowSession(row, byId) {
			if (row.querySelector(":scope > .projectText") !== null) return null;
			const titleEl = row.querySelector(":scope > .title");
			if (!titleEl || !titleEl.textContent) return null;
			const titleText = titleEl.textContent.trim();
			for (const id of Object.keys(byId)) {
				const s = byId[id];
				if (!s) continue;
				if (s.blank) continue;
				if (s.displayTitle === titleText) return {
					id,
					cwd: String(s.cwd ?? ""),
					title: titleText,
					running: s.running === true
				};
			}
			return null;
		}
		/** Whether a `[role=treeitem]` row belongs to a deletable (non-blank) session. */
		function isDeletableRow(row) {
			return row.querySelector(":scope > .rowActions") !== null;
		}
		/**
		* Enumerate the deletable session rows currently in the tree container, with
		* their resolved session identity. Used by the visibility reconciler so a fresh
		* row created after a group collapse/re-expand is matched and hidden correctly
		* within the 10s window.
		*/
		function reconcileFromDom(container, byId, fn) {
			for (const row of container.querySelectorAll("[role=\"treeitem\"]")) {
				if (row.querySelector(":scope > .rowActions") === null) continue;
				const action = resolveRowSession(row, byId);
				if (action) fn(row, action);
			}
		}
		/**
		* Build the injection controller bound to one client `apply(ctx)`.
		* @param getById - snapshot of `sessions.list.byId` (re-read on each sync).
		* @param onDelete - called when a delete button is clicked; the caller hides
		*   the row and parks the deferred deletion.
		*/
		function createDeleteController(getContext, onDelete) {
			const rowById = /* @__PURE__ */ new Map();
			const injectIntoRow = (row) => {
				if (!isDeletableRow(row)) return;
				const byId = getContext().sessions.list.getSnapshot().byId;
				const action = resolveRowSession(row, byId);
				if (!action) return;
				const actions = row.querySelector(":scope > .rowActions");
				if (!(actions instanceof HTMLElement)) return;
				if (actions.querySelector("[data-dsh-sm-delete]") !== null) return;
				rowById.set(action.id, row);
				const btn = document.createElement("button");
				btn.type = "button";
				btn.dataset.dshSmDelete = "true";
				btn.title = action.running ? "请先结束运行中的会话" : "删除会话";
				btn.setAttribute("aria-label", `删除会话 ${action.title}`);
				btn.textContent = "🗑";
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					const fresh = resolveRowSession(row, getContext().sessions.list.getSnapshot().byId) ?? action;
					if (fresh.running) {
						window.alert("请先结束运行中的会话，再进行删除");
						return;
					}
					onDelete(fresh, row);
				});
				actions.appendChild(btn);
			};
			const sync = () => {
				const container = document.querySelector(SESSIONS_LIST_SEL);
				if (!container) return;
				for (const [id, el] of Array.from(rowById.entries())) if (!el.isConnected) rowById.delete(id);
				for (const row of container.querySelectorAll(":scope [role=\"treeitem\"]")) injectIntoRow(row);
			};
			return {
				sync,
				rowById,
				dispose: () => {}
			};
		}
		//#endregion
		//#region \0dsh-css:src/client/rail.module.css.mjs
		const css = ".FPsCja_rail{z-index:2147483000;border:1px solid var(--dsw-alias-border-l2,#8080804d);background:var(--dsw-alias-bg-overlay,#18181cf5);max-width:min(520px,100vw - 24px);box-shadow:var(--dsw-shadow-lv3,0 8px 28px #0006);color:var(--dsw-alias-label-primary,#e8e8ec);font-family:var(--dsw-font-body,system-ui, sans-serif);pointer-events:auto;border-radius:12px;flex-flow:wrap;justify-content:center;align-items:center;gap:12px;padding:8px 8px 8px 14px;font-size:13px;line-height:1.4;animation:.16s ease-out FPsCja_rail-in;display:flex;position:fixed;bottom:18px;left:50%;transform:translate(-50%)}@keyframes FPsCja_rail-in{0%{opacity:0;transform:translate(-50%)translateY(8px)}to{opacity:1;transform:translate(-50%)translateY(0)}}.FPsCja_item{flex-direction:row;align-items:center;gap:10px;max-width:100%;display:flex}.FPsCja_label{flex-direction:column;min-width:0;display:flex}.FPsCja_title{text-overflow:ellipsis;white-space:nowrap;max-width:200px;font-size:13px;font-weight:500;overflow:hidden}.FPsCja_countdown,.FPsCja_add{color:var(--dsw-alias-label-tertiary,#c8c8d29e);font-size:11px}.FPsCja_undo{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-button-elevated-fill,#ffffff0f);color:var(--dsw-alias-state-business-primary,#4f8cff);border-radius:8px;flex:none;padding:4px 10px;font-family:inherit;font-size:12px;font-weight:500}.FPsCja_undo:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff1a)}.FPsCja_failed{color:var(--dsw-alias-state-error-primary,#ff6b6b);text-align:left;background:0 0;border:none;min-width:0;font-family:inherit;font-size:13px}.FPsCja_dismiss{cursor:pointer;color:var(--dsw-alias-label-tertiary,#c8c8d29e);background:0 0;border:none;border-radius:6px;flex:none;padding:2px 4px;font-family:inherit;font-size:16px;line-height:1}.FPsCja_dismiss:hover{color:var(--dsw-alias-label-primary,#e8e8ec)}.FPsCja_divider{background:var(--dsw-alias-border-l2,#80808040);align-self:stretch;width:1px}.FPsCja_deleteBtn{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-state-error-primary,#ff6b6b);opacity:.85;background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;font-size:12px;line-height:1;display:inline-flex}.FPsCja_deleteBtn:hover{color:var(--dsw-alias-state-error-primary,#ff6b6b);background:var(--dsw-alias-interactive-bg-hover,#ffffff1a);opacity:1}.FPsCja_entryButton{cursor:pointer;color:var(--dsw-alias-label-secondary,#e6e6ecd1);font-family:var(--dsw-font-body,system-ui, sans-serif);background:0 0;border:none;border-radius:8px;justify-content:center;align-items:center;gap:6px;padding:6px 10px;font-size:14px;line-height:20px;display:inline-flex}.FPsCja_entryButton:hover{color:var(--dsw-alias-label-primary,#e8e8ec);background:var(--dsw-alias-interactive-bg-hover,#ffffff14)}.FPsCja_overlay{z-index:2147482000;border:1px solid var(--dsw-alias-border-l2,#8080804d);background:var(--dsw-alias-bg-overlay,#18181cfa);width:min(360px,100vw - 24px);max-height:min(480px,100vh - 120px);box-shadow:var(--dsw-shadow-lv3,0 8px 28px #0006);color:var(--dsw-alias-label-primary,#e8e8ec);font-family:var(--dsw-font-body,system-ui, sans-serif);pointer-events:auto;border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:56px;left:12px;overflow:hidden}.FPsCja_head{border-bottom:1px solid var(--dsw-alias-border-l2,#80808038);justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;font-size:14px;font-weight:600;display:flex}.FPsCja_close{cursor:pointer;color:var(--dsw-alias-label-tertiary,#c8c8d29e);background:0 0;border:none;border-radius:6px;padding:2px 6px;font-family:inherit;font-size:16px;line-height:1}.FPsCja_close:hover{color:var(--dsw-alias-label-primary,#e8e8ec);background:var(--dsw-alias-interactive-bg-hover,#ffffff14)}.FPsCja_list{flex-direction:column;min-height:0;padding:4px;display:flex;overflow-y:auto}.FPsCja_row{border-radius:8px;align-items:center;gap:8px;padding:7px 8px;display:flex}.FPsCja_row:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff0f)}.FPsCja_rowTitle{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;font-size:13px;overflow:hidden}.FPsCja_action{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-button-elevated-fill,#ffffff0d);color:var(--dsw-alias-label-secondary,#e6e6ecd1);border-radius:7px;flex:none;padding:3px 9px;font-family:inherit;font-size:12px}.FPsCja_action:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff17);color:var(--dsw-alias-label-primary,#e8e8ec)}.FPsCja_danger{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-button-elevated-fill,#ffffff0d);color:var(--dsw-alias-state-error-primary,#ff6b6b);border-radius:7px;flex:none;padding:3px 9px;font-family:inherit;font-size:12px}.FPsCja_danger:hover{background:var(--dsw-alias-interactive-bg-hover,#ffffff17);color:var(--dsw-alias-state-error-primary,#ff6b6b)}.FPsCja_empty{text-align:center;color:var(--dsw-alias-label-tertiary,#c8c8d29e);padding:20px 14px;font-size:13px}.FPsCja_errorBanner{color:var(--dsw-alias-state-error-primary,#ff6b6b);border-bottom:1px solid var(--dsw-alias-border-l2,#80808038);padding:8px 12px;font-size:12px}.FPsCja_trashBar{border-top:1px solid var(--dsw-alias-border-l2,#80808038);align-items:center;gap:10px;padding:8px 12px;display:flex}.FPsCja_trashButton{cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#80808059);background:var(--dsw-alias-button-elevated-fill,#ffffff0d);color:var(--dsw-alias-state-error-primary,#ff6b6b);border-radius:7px;flex:none;padding:4px 11px;font-family:inherit;font-size:12px}.FPsCja_trashButton:disabled{cursor:default;opacity:.45;color:var(--dsw-alias-label-tertiary,#c8c8d299)}.FPsCja_trashCount{color:var(--dsw-alias-label-tertiary,#c8c8d29e);text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:12px;overflow:hidden}";
		const tagId = "dsh-session-manager/rail.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-session-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var rail_module_css_default = {
			"entryButton": "FPsCja_entryButton",
			"danger": "FPsCja_danger",
			"undo": "FPsCja_undo",
			"deleteBtn": "FPsCja_deleteBtn",
			"overlay": "FPsCja_overlay",
			"close": "FPsCja_close",
			"countdown": "FPsCja_countdown",
			"rail-in": "FPsCja_rail-in",
			"label": "FPsCja_label",
			"head": "FPsCja_head",
			"action": "FPsCja_action",
			"failed": "FPsCja_failed",
			"add": "FPsCja_add",
			"dismiss": "FPsCja_dismiss",
			"item": "FPsCja_item",
			"list": "FPsCja_list",
			"errorBanner": "FPsCja_errorBanner",
			"divider": "FPsCja_divider",
			"trashBar": "FPsCja_trashBar",
			"trashButton": "FPsCja_trashButton",
			"rail": "FPsCja_rail",
			"trashCount": "FPsCja_trashCount",
			"rowTitle": "FPsCja_rowTitle",
			"title": "FPsCja_title",
			"row": "FPsCja_row",
			"empty": "FPsCja_empty"
		};
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
		* Two entry kinds:
		*   - pending (undoable): title + seconds remaining, with an Undo button.
		*   - failed (retain window): an error readout; the session is already
		*     re-shown. Failed entries are auto-cleared by the state machine after
		*     a short window, so no manual dismissal is needed here.
		*/
		const getSnapshot = () => pendingDeletes.snapshot();
		const subscribe = (listener) => pendingDeletes.subscribe(listener);
		/** One entry row. `now` is passed by the parent tick so all rows share a clock. */
		function EntryRow({ entry, now }) {
			if (entry.state === "failed") return (0, react.createElement)("div", { className: rail_module_css_default.item }, (0, react.createElement)("span", {
				className: rail_module_css_default.failed,
				title: entry.error ? `删除失败：${entry.error}` : "删除失败"
			}, `「${entry.title}」删除失败，已恢复`));
			const remaining = Math.max(0, Math.ceil((entry.deadline - now) / 1e3));
			return (0, react.createElement)("div", {
				className: rail_module_css_default.item,
				style: { gap: 10 }
			}, (0, react.createElement)("div", { className: rail_module_css_default.label }, (0, react.createElement)("div", { className: rail_module_css_default.title }, entry.title), (0, react.createElement)("div", { className: rail_module_css_default.countdown }, `撤销删除（${remaining}秒）`)), (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.undo,
				onClick: () => {
					pendingDeletes.undo(entry.id);
				}
			}, "撤销"));
		}
		function UndoRail() {
			const entries = (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
			if (entries.length === 0) return null;
			const now = Date.now();
			const items = entries.map((entry, i) => {
				const row = (0, react.createElement)(EntryRow, {
					entry,
					now,
					key: entry.id
				});
				if (i === 0) return row;
				return (0, react.createElement)("div", {
					key: entry.id + "-wrap",
					className: rail_module_css_default.item,
					style: { gap: 12 }
				}, (0, react.createElement)("div", { className: rail_module_css_default.divider }), row);
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
		* Close the overlay via the injected workspaces/sessions ambient context (kept
		* a parameter so the component stays purely presentational). The host already
		* broadcasts changes; this is only the local toggle entry point.
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
			}, (0, react.createElement)("span", { "aria-hidden": true }, "🗂"), wide ? (0, react.createElement)("span", null, "归档") : null);
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
			const [trashError, setTrashError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				if (!open) return;
				let cancelled = false;
				smTrash().then((res) => {
					if (cancelled) return;
					if (res.ok) setTrashCount(Array.isArray(res.items) ? res.items.length : 0);
					else setTrashError(`读取回收站失败：${res.code ?? res.message ?? "unknown"}`);
				});
				return () => {
					cancelled = true;
				};
			}, [open]);
			if (!open) return null;
			/** Confirm-then-empty the recycle bin (unrecoverable) — defined in-component
			*  so it captures the trash state setters. `window.confirm` is a genuine
			*  modal; we call /sm/emptyTrash with confirm:true on confirmation. Failures
			*  are surfaced, never swallowed; the count is re-read so the UI re-syncs. */
			const onEmptyTrash = async (count) => {
				if (!window.confirm(`将永久删除回收站中的 ${count} 个会话，此操作不可撤销。确定继续？`)) return;
				const res = await smEmptyTrash(true);
				if (!res.ok) {
					setTrashError(`清空回收站失败：${res.code ?? res.message ?? "unknown"}`);
					return;
				}
				setTrashError(null);
				const t = await smTrash();
				if (t.ok) setTrashCount(Array.isArray(t.items) ? t.items.length : 0);
			};
			const byId = sessionsSnap.byId;
			const parked = new Set(pending.filter((e) => e.state === "pending").map((e) => e.id));
			const rows = [];
			for (const id of workspacesSnap.archivedSessionIds) {
				const s = byId[id];
				if (!s || s.blank || parked.has(id)) continue;
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
			}, (0, react.createElement)("div", { className: rail_module_css_default.rowTitle }, row.displayTitle), (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.action,
				onClick: () => void unarchive(ctx, row.id)
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
			return (0, react.createElement)("div", {
				className: rail_module_css_default.overlay,
				role: "dialog",
				"aria-label": "归档会话"
			}, (0, react.createElement)("div", { className: rail_module_css_default.head }, (0, react.createElement)("span", null, "归档"), (0, react.createElement)("button", {
				type: "button",
				className: rail_module_css_default.close,
				"aria-label": "关闭归档视图",
				onClick: () => setArchiveOpen(false)
			}, "✕")), trashError && (0, react.createElement)("div", {
				className: rail_module_css_default.errorBanner,
				role: "alert"
			}, trashError), body, trashBar);
		}
		/** Remove a session id from the archive set via /sm/unarchive. */
		async function unarchive(ctx, id) {
			const res = await smUnarchive(id);
			if (!res.ok) {
				ctx.workspaces.refresh();
				console.error("[dsh-session-manager] 取消归档失败：", res.code ?? res.message);
			}
		}
		/** Park a deferred delete for an archived session (host two-step on fire). */
		function requestArchivedDelete(_ctx, row) {
			pendingDeletes.requestDelete(row.id, row.cwd, row.displayTitle);
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
				pendingDeletes.requestDelete(action.id, action.cwd, action.title);
			});
			/** Hide/restore rows whose ids are parked vs active in the park table. The
			*  DOM is reconciled fresh so a row re-created after a group collapse stays
			*  hidden for its remaining window. */
			const reconcileVisibility = () => {
				for (const [id, row] of controller.rowById.entries()) {
					if (!row.isConnected) continue;
					const hide = pendingDeletes.get(id)?.state === "pending";
					const current = row.style.display;
					if (hide && current !== "none") row.style.display = "none";
					if (!hide && current === "none") row.style.display = "";
				}
				const container = document.querySelector(SESSIONS_LIST_SEL);
				if (container) reconcileFromDom(container, ctx.sessions.list.getSnapshot().byId, (row, action) => {
					const shouldHide = pendingDeletes.get(action.id)?.state === "pending";
					if (shouldHide && row.style.display !== "none") row.style.display = "none";
					if (!shouldHide && row.style.display === "none") row.style.display = "";
				});
			};
			/** Clear selection if the deleted session was the current one (A-5). */
			const reconcileSelection = () => {
				const current = ctx.sessions.list.getSnapshot().current;
				if (current === void 0) return;
				if (pendingDeletes.isPending(current)) ctx.sessions.clear();
			};
			const offPending = pendingDeletes.subscribe(() => {
				reconcileVisibility();
				reconcileSelection();
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
			overlays.render((0, react.createElement)("div", { style: { pointerEvents: "none" } }, (0, react.createElement)(UndoRail), (0, react.createElement)(ArchiveView, {
				ctx,
				sessionsFeed: ctx.sessions.list,
				workspacesFeed: ctx.workspaces.list
			})));
			sync();
			ctx.effect(() => () => {
				disposeSlot();
				offPending();
				offList();
				mo.disconnect();
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
