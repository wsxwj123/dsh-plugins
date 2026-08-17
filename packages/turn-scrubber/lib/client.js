window.__ModuleLoader__.load({
	id: "dsh-turn-scrubber",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		let active = null;
		function targetInSnapshot(chat, turnId) {
			const keys = chat?.locations?.turns?.get(turnId);
			return keys !== void 0 && keys.length > 0;
		}
		function fail(loop, result) {
			if (loop.done) return;
			loop.done = true;
			if (active === loop) active = null;
			loop.settle(result);
		}
		/** Run one loop; never more than one at a time (single-flight). */
		async function runLoop(loop) {
			while (active === loop && !loop.done) {
				const snap = loop.session.snapshotCache;
				if (targetInSnapshot(snap.chat, loop.turnId)) {
					fail(loop, "达成");
					return;
				}
				if (snap.openState !== void 0 && snap.openState !== "open") {
					console.warn("[dsh-turn-scrubber] loadOlder skipped: session not open");
					fail(loop, "到最老");
					return;
				}
				if (snap.loadingOlder === true) {
					await new Promise((resolve) => setTimeout(resolve, 0));
					continue;
				}
				if (snap.hasMore === false) {
					console.warn("[dsh-turn-scrubber] unloaded turn not reachable: hasMore=false");
					fail(loop, "到最老");
					return;
				}
				if (loop.page >= 40) {
					console.warn(`[dsh-turn-scrubber] load loop stopped after 40 pages`);
					fail(loop, "超限");
					return;
				}
				await loop.session.loadOlder();
				loop.page++;
				if (active !== loop || loop.done) {
					fail(loop, "会话切换");
					return;
				}
			}
			if (!loop.done) fail(loop, "会话切换");
		}
		/**
		* Ensure the target turn is present in the loaded snapshot, paging older
		* history as needed (single-flight, see module doc).
		* @returns the load-loop outcome; on '达成' the caller may scroll to the
		*          turn key now present in `snapshot.chat.locations.turns`.
		*/
		function ensureTurnLoaded({ session, turnId, token }) {
			if (targetInSnapshot(session.snapshotCache.chat, turnId)) return Promise.resolve("已加载");
			if (active !== null && active.session === session && active.token === token && active.turnId === turnId && !active.done) return new Promise((resolve) => {
				const original = active.settle;
				active.settle = (result) => {
					original(result);
					resolve(result);
				};
			});
			if (active !== null) fail(active, "会话切换");
			return new Promise((resolve) => {
				const loop = {
					session,
					token,
					turnId,
					page: 0,
					resolve,
					settle: resolve,
					done: false
				};
				active = loop;
				runLoop(loop);
			});
		}
		/**
		* Terminate any active load loop for a given session (session switch /
		* teardown). The loop resolves its waiter with `'会话切换'`; subsequent
		* responses are discarded by the loop's own active-check.
		*/
		function cancelTurnLoads(session) {
			if (active !== null && active.session === session) fail(active, "会话切换");
		}
		/** Terminate whatever loop is active (plugin dispose). */
		function cancelAllTurnLoads() {
			if (active !== null) fail(active, "会话切换");
		}
		//#endregion
		//#region \0dsh-css:src/client/rail.module.css.mjs
		const css = "._7YEcIa_rail{z-index:45;pointer-events:auto;width:18px;position:absolute;right:6px}._7YEcIa_group{pointer-events:auto;flex-direction:column;align-items:flex-end;padding:0 0 0 14px;display:flex;position:absolute;right:0}._7YEcIa_line{cursor:pointer;background:0 0;border:none;justify-content:flex-end;align-items:center;margin:0;padding:0;display:flex}._7YEcIa_compacted{cursor:pointer}._7YEcIa_compacted ._7YEcIa_bar{opacity:.28}._7YEcIa_loading{color:var(--dsw-alias-label-tertiary,#c8c8d299);pointer-events:none;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;animation:.14s ease-out _7YEcIa_tip-in;position:absolute}._7YEcIa_bar{transform-origin:100%;will-change:transform;border-radius:1px;flex:none;height:2px;transition:transform 90ms ease-out,background-color .16s,opacity .16s;display:block}._7YEcIa_tip{border:1px solid var(--dsw-alias-border-l2,#8080804d);background:var(--dsw-alias-bg-overlay,#18181cf0);width:max-content;max-width:280px;box-shadow:var(--dsw-shadow-lv2,0 4px 16px #00000059);pointer-events:auto;color:var(--dsw-alias-label-primary,#e8e8ec);font-family:var(--dsw-font-body,system-ui, sans-serif);border-radius:8px;padding:6px 10px;font-size:12px;line-height:1.45;animation:.14s ease-out _7YEcIa_tip-in;position:absolute;transform:translateY(-50%)}@keyframes _7YEcIa_tip-in{0%{opacity:0;transform:translateY(-50%)translate(5px)}to{opacity:1;transform:translateY(-50%)translate(0)}}._7YEcIa_tipTitle{color:var(--dsw-alias-label-tertiary,#c8c8d299);margin-bottom:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px}._7YEcIa_tipText{-webkit-line-clamp:2;word-break:break-word;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}@media (width<=767px){._7YEcIa_rail{display:none}}";
		const tagId = "dsh-turn-scrubber/rail.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-turn-scrubber";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var rail_module_css_default = {
			"compacted": "_7YEcIa_compacted",
			"bar": "_7YEcIa_bar",
			"tipTitle": "_7YEcIa_tipTitle",
			"line": "_7YEcIa_line",
			"loading": "_7YEcIa_loading",
			"tip": "_7YEcIa_tip",
			"tipText": "_7YEcIa_tipText",
			"tip-in": "_7YEcIa_tip-in",
			"group": "_7YEcIa_group",
			"rail": "_7YEcIa_rail"
		};
		//#endregion
		//#region src/client/TurnRail.tsx
		/**
		* TurnRail — the Codex-style turn cluster.
		*
		* A block of THIN HORIZONTAL lines pinned to the right edge of the
		* conversation window, VERTICALLY CENTERED in the message area (it does not
		* map message positions — it is a fixed control, not a minimap). Each user
		* turn is one line; more turns → more lines, and the block widens gently
		* leftward as it grows. IDLE lines are all the same short length — uniform
		* and unobtrusive while chatting.
		*
		* Hover: the line nearest the pointer magnifies (scaleX) and brightens with
		* a distance falloff, so the cluster ripples like a waveform — the wave
		* variation is hover-only. Click: smooth-scrolls to that turn via the
		* conversation's native `[data-chat-anchor-key]` rows (rAF easing —
		* programmatic smooth scrollIntoView is unreliable in some webviews).
		*
		* Positioning: the rail is a sibling of the `[data-conversation-scroll]`
		* scrollport inside its relative parent, sized from the scrollport's layout
		* offsets (offsetTop/offsetHeight are layout px, immune to CSS zoom).
		*
		* Full-index rendering (this feature): when the host `turnIndex` is available
		* the rail draws ALL turns — loaded (waveform + snapshot tooltip + smooth
		* scroll, unchanged), compacted (gray placeholder line,「已压缩」tooltip, click
		* scrolls near the load-older control), and unloaded (preview tooltip, click
		* runs the single-flight `ensureTurnLoaded` loop, then scrolls). When the
		* index is unavailable the rail degrades to the loaded-only behavior.
		*
		* Key mapping: line index i (0-based, oldest at top) ↔ turn number i+1
		* (spike-verified identity with `locations.turns` keys); the mapping goes
		* through `hostIndex.turns[i].turn` when present so a key divergence would
		* still resolve correctly (重要 5).
		*/
		/** Visual line thickness (px). */
		const GAP = 5;
		/** Hit-area height per line (px) — thin visuals need a comfortable target. */
		const HIT = 10;
		/** Block width growth: ALL idle lines share one uniform length — short, and
		*  the block widens gently as turns grow (idle stays unobtrusive; the wave
		*  variation only appears on hover). */
		const BASE_LEN = 3;
		const STEP_LEN = .75;
		const MAX_LEN = 17;
		const FALLOFF = 1.4;
		function waveScale(d) {
			return 1 + 1.4 * Math.exp(-(d * d) / FALLOFF);
		}
		function waveGlow(d) {
			return .4 + .6 * Math.exp(-(d * d) / FALLOFF);
		}
		/** Block width for the current turn count (uniform across all lines). */
		function blockWidth(count) {
			return Math.min(MAX_LEN, BASE_LEN + Math.max(0, count - 2) * STEP_LEN);
		}
		/**
		* Collect loaded turns from the chat snapshot: turn id → first-user-node key
		* + text. Mirrors the pre-feature `collectTurns` semantics.
		*/
		function collectLoadedTurns(chat) {
			const out = /* @__PURE__ */ new Map();
			if (!chat) return out;
			const turnKeys = chat.locations?.turns;
			if (!turnKeys) return out;
			for (const [turn, keys] of turnKeys.entries()) {
				if (keys.length === 0) continue;
				let nodeKey;
				for (const key of keys) {
					const kind = chat.nodes.get(key)?.kind;
					if (kind === "user" || kind === "steering") {
						nodeKey = key;
						break;
					}
				}
				if (nodeKey === void 0) nodeKey = keys[0];
				const node = chat.nodes.get(nodeKey);
				out.set(turn, {
					key: nodeKey,
					text: textOfContent(node?.data?.content)
				});
			}
			return out;
		}
		/**
		* Build the rail line list. With a host index the skeleton is the FULL turn
		* list (three states); without it, only the loaded turns (degrade path).
		*/
		function buildLines(hostIndex, chat, loaded) {
			if (hostIndex !== null) {
				const lines = [];
				for (let i = 0; i < hostIndex.turns.length; i++) {
					const entry = hostIndex.turns[i];
					const turn = typeof entry?.turn === "number" ? entry.turn : i + 1;
					const ld = loaded.get(turn);
					if (ld !== void 0) lines.push({
						turn,
						state: "loaded",
						anchorKey: ld.key,
						text: ld.text
					});
					else if (entry?.compacted === true) lines.push({
						turn,
						state: "compacted",
						text: ""
					});
					else lines.push({
						turn,
						state: "unloaded",
						anchorKey: void 0,
						text: entry?.preview ?? ""
					});
				}
				return lines;
			}
			return [...loaded.entries()].sort(([a], [b]) => a - b).map(([turn, ld]) => ({
				turn,
				state: "loaded",
				anchorKey: ld.key,
				text: ld.text
			}));
		}
		/**
		* Extract plain text from a node's content, which may be a string, an array
		* of Anthropic-style content blocks (`[{type:"text",text:"..."}, ...]`), or a
		* structured object — never render non-string values as React children.
		*/
		function textOfContent(content) {
			if (typeof content === "string") return content;
			if (Array.isArray(content)) {
				let out = "";
				for (const block of content) if (typeof block === "string") out += block;
				else if (block !== null && typeof block === "object") {
					const b = block;
					if (typeof b.text === "string") out += b.text;
					else if (typeof b.content === "string") out += b.content;
				}
				return out;
			}
			if (content !== null && typeof content === "object") {
				const c = content;
				if (typeof c.text === "string") return c.text;
				if (typeof c.content === "string") return c.content;
			}
			return "";
		}
		/** Smooth-scroll the scrollport so the anchor row sits near the top. */
		function scrollToRow(scrollport, row) {
			const target = Math.max(0, row.offsetTop - 8);
			const start = scrollport.scrollTop;
			const dist = target - start;
			if (Math.abs(dist) < 2) return;
			const dur = 320;
			let t0 = null;
			const ease = (p) => 1 - Math.pow(1 - p, 3);
			const step = (ts) => {
				if (t0 === null) t0 = ts;
				const p = Math.min(1, (ts - t0) / dur);
				scrollport.scrollTop = start + dist * ease(p);
				if (p < 1) requestAnimationFrame(step);
			};
			requestAnimationFrame(step);
		}
		/** Find the native「加载更早」button inside the scrollport (text-localized). */
		function findLoadOlderControl(scrollport) {
			const buttons = scrollport.querySelectorAll("button");
			for (const button of buttons) {
				const text = button.textContent?.trim();
				if (text === "加载更早" || text === "Load earlier") return button;
			}
			return null;
		}
		/** Scroll to the very first row of the loaded window (fallback target). */
		function scrollToWindowFront(scrollport) {
			const first = scrollport.querySelector("[data-chat-anchor-key]");
			if (first) scrollToRow(scrollport, first);
		}
		/** Scroll to one loaded turn's anchor row by key; fallback to window front. */
		function scrollToTurn(scrollport, key) {
			const row = scrollport.querySelector(`[data-chat-anchor-key="${CSS.escape(key)}"]`);
			if (row) scrollToRow(scrollport, row);
			else scrollToWindowFront(scrollport);
		}
		function TurnRail({ session, scrollport, hostIndex, token }) {
			const snap = (0, react.useSyncExternalStore)((0, react.useCallback)((cb) => session.subscribe(cb), [session]), (0, react.useCallback)(() => session.snapshotCache, [session]));
			const loaded = (0, react.useMemo)(() => collectLoadedTurns(snap?.chat), [snap]);
			const lines = (0, react.useMemo)(() => buildLines(hostIndex, snap?.chat, loaded), [
				hostIndex,
				snap,
				loaded
			]);
			const [loadingTurn, setLoadingTurn] = (0, react.useState)(null);
			const [hoverPos, setHoverPos] = (0, react.useState)(null);
			const [tip, setTip] = (0, react.useState)(null);
			const [box, setBox] = (0, react.useState)(null);
			const showTimer = (0, react.useRef)(0);
			const hideTimer = (0, react.useRef)(0);
			const hoverTimer = (0, react.useRef)(0);
			const groupRef = (0, react.useRef)(null);
			const measure = (0, react.useCallback)(() => {
				const sp = scrollport;
				const parent = sp.parentElement;
				if (!parent) return;
				const seat = sp.querySelector("[data-composer-seat]");
				setBox({
					top: sp.offsetTop - parent.offsetTop,
					height: sp.offsetHeight,
					seat: seat?.offsetHeight ?? 0
				});
			}, [scrollport]);
			(0, react.useLayoutEffect)(() => {
				measure();
			}, [measure]);
			(0, react.useEffect)(() => {
				const ro = new ResizeObserver(measure);
				ro.observe(scrollport);
				const seat = scrollport.querySelector("[data-composer-seat]");
				if (seat) ro.observe(seat);
				window.addEventListener("resize", measure);
				return () => {
					ro.disconnect();
					window.removeEventListener("resize", measure);
				};
			}, [scrollport, measure]);
			(0, react.useEffect)(() => () => {
				clearTimeout(showTimer.current);
				clearTimeout(hideTimer.current);
				clearTimeout(hoverTimer.current);
			}, []);
			if (!box || lines.length < 2) return null;
			const count = lines.length;
			const width = blockWidth(count);
			const areaH = Math.max(0, box.height - box.seat);
			if (areaH < 40) return null;
			const groupH = count * HIT + (count - 1) * GAP;
			const gap = groupH > areaH ? Math.max(2, Math.round(GAP * areaH / groupH)) : GAP;
			const realGroupH = count * HIT + (count - 1) * gap;
			const groupTop = Math.max(4, areaH / 2 - realGroupH / 2);
			/** Fractional line-unit position from a viewport Y. */
			const hoverFromPointer = (clientY) => {
				const top = groupRef.current?.getBoundingClientRect().top;
				if (top === void 0) return 0;
				return (clientY - top - HIT / 2) / (HIT + gap);
			};
			const enter = (frac) => {
				clearTimeout(hoverTimer.current);
				setHoverPos(frac);
				const idx = Math.max(0, Math.min(count - 1, Math.round(frac)));
				clearTimeout(hideTimer.current);
				clearTimeout(showTimer.current);
				showTimer.current = window.setTimeout(() => setTip(idx), 220);
			};
			/** Pointer left the rail/tip: hide the tooltip soon, collapse the wave late
			*  (generous grace so scrubbing or reading the tooltip never snaps it). */
			const park = () => {
				clearTimeout(showTimer.current);
				clearTimeout(hoverTimer.current);
				hoverTimer.current = window.setTimeout(() => setHoverPos(null), 600);
				clearTimeout(hideTimer.current);
				hideTimer.current = window.setTimeout(() => setTip(null), 120);
			};
			/** Pointer is back on the rail or the sticky tooltip: cancel any pending park. */
			const keepAlive = () => {
				clearTimeout(hoverTimer.current);
				clearTimeout(showTimer.current);
				clearTimeout(hideTimer.current);
			};
			/** Click on an unloaded line: page older until the turn appears, then scroll. */
			const handleUnloadedClick = (turn) => {
				if (loadingTurn !== null) return;
				setLoadingTurn(turn);
				ensureTurnLoaded({
					session,
					turnId: turn,
					token
				}).then((result) => {
					setLoadingTurn(null);
					if (result === "达成" || result === "已加载") {
						const key = collectLoadedTurns(session.snapshotCache.chat).get(turn)?.key;
						if (key !== void 0) scrollToTurn(scrollport, key);
						else scrollToWindowFront(scrollport);
					} else scrollToWindowFront(scrollport);
				});
			};
			/** Click on a compacted line: head toward the「加载更早」control. */
			const handleCompactedClick = () => {
				const control = findLoadOlderControl(scrollport);
				if (control) scrollToRow(scrollport, control);
				else scrollToWindowFront(scrollport);
			};
			const handleLineClick = (line) => {
				if (line.state === "loaded" && line.anchorKey !== void 0) scrollToTurn(scrollport, line.anchorKey);
				else if (line.state === "compacted") handleCompactedClick();
				else handleUnloadedClick(line.turn);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: rail_module_css_default.rail,
				style: {
					top: box.top,
					height: areaH
				},
				onMouseMove: (e) => enter(hoverFromPointer(e.clientY)),
				onMouseLeave: park,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						ref: groupRef,
						className: rail_module_css_default.group,
						style: {
							top: groupTop,
							gap
						},
						children: lines.map((line, i) => {
							const d = hoverPos === null ? Infinity : i - hoverPos;
							const className = line.state === "compacted" ? `${rail_module_css_default.line} ${rail_module_css_default.compacted}` : rail_module_css_default.line;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className,
								style: { height: HIT },
								onClick: () => handleLineClick(line),
								"aria-label": `跳到第 ${line.turn} 个回合${line.state === "compacted" ? "（已压缩）" : ""}`,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: rail_module_css_default.bar,
									style: {
										width: Math.round(width),
										transform: `scaleX(${waveScale(d)})`,
										opacity: waveGlow(d),
										background: line.state === "compacted" ? "var(--dsw-alias-label-tertiary)" : d < .5 && d > -.5 ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)"
									}
								})
							}, line.turn);
						})
					}),
					loadingTurn !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: rail_module_css_default.loading,
						style: {
							top: Math.max(4, groupTop - 14),
							right: 2
						},
						children: "加载中…"
					}),
					tip !== null && lines[tip] && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: rail_module_css_default.tip,
						style: {
							top: groupTop + tip * (HIT + gap) + HIT / 2,
							right: width + 12
						},
						onMouseEnter: keepAlive,
						onMouseLeave: park,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: rail_module_css_default.tipTitle,
							children: [
								"回合 ",
								lines[tip].turn,
								lines[tip].state === "compacted" ? " · 已压缩" : lines[tip].state === "unloaded" ? " · 未加载" : ""
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: rail_module_css_default.tipText,
							children: lines[tip].state === "compacted" ? "该回合已被压缩，点击可跳转到「加载更早」" : (lines[tip].text || "(空消息)").slice(0, 200)
						})]
					})
				]
			});
		}
		//#endregion
		//#region src/client/hostIndex.ts
		/** Channel + endpoint registered by the node half (INTERFACE §1.1). */
		const TURN_INDEX_CHANNEL = "/turn-scrubber";
		const TURN_INDEX_ENDPOINT = "turnIndex";
		const cache = /* @__PURE__ */ new Map();
		/** Snapshot fingerprint: loaded turn count + visible order length. */
		function indexFingerprint(chat) {
			if (chat === void 0) return "e:0";
			return `${chat.locations?.turns?.size ?? 0}:${chat.order.length}`;
		}
		/**
		* Fetch (or return cached) turn index for a session.
		* @param connection - injected client connection service face.
		* @param sessionId - the session the caller is bound to.
		* @param chat - current chat snapshot used for the cache fingerprint.
		* @returns the index, or null when unavailable (degrade path).
		*/
		async function loadTurnIndex(connection, sessionId, chat) {
			const fingerprint = indexFingerprint(chat);
			const cached = cache.get(sessionId);
			if (cached !== void 0 && cached.fingerprint === fingerprint) return cached.result;
			let result = null;
			try {
				const response = await connection.rpc.call(TURN_INDEX_CHANNEL, TURN_INDEX_ENDPOINT, { sessionId });
				if (response.ok === true && response.sessionId === sessionId) result = response;
				else if (response.ok === false) console.warn(`[dsh-turn-scrubber] turnIndex failed for session: ${response.error.code}`);
			} catch (error) {
				console.warn("[dsh-turn-scrubber] turnIndex unavailable:", error instanceof Error ? error.message : String(error));
			}
			cache.set(sessionId, {
				fingerprint,
				result
			});
			return result;
		}
		/** Drop this session's cached index (call on teardown / session switch). */
		function clearTurnIndexCache(sessionId) {
			cache.delete(sessionId);
		}
		/** Drop every cached index (plugin dispose). */
		function resetTurnIndexCache() {
			cache.clear();
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* Client half of dsh-turn-scrubber: mounts the waveform turn rail onto the
		* right edge of the active conversation view.
		*
		* The rail reads the runtime session store (`ctx.sessions.list` for the
		* active session id, `ctx.sessions.binding(id).session` for the live chat
		* snapshot) and anchors its bars to the conversation's native
		* `[data-chat-anchor-key]` rows inside the `[data-conversation-scroll]`
		* scrollport. It re-mounts when the active session changes and when the
		* conversation DOM is replaced.
		*
		* Host index wiring (this feature): on attach and whenever the snapshot's
		* turn fingerprint grows, the full turn index is fetched through
		* `ctx.connection.rpc` (`loadTurnIndex`) and handed to the rail as the render
		* skeleton. A fetched index is only applied when its `sessionId` still matches
		* the currently bound session (重要 3), so a stale cross-session response can
		* never paint the wrong rail. Teardown cancels in-flight load loops and drops
		* the session's cached index.
		*/
		/** Services required before mounting (provided by the client runtime). */
		const inject = ["sessions", "connection"];
		/** Minimum delay between DOM-recovery attach attempts (cheap guard). */
		const ATTACH_COOLDOWN_MS = 300;
		/**
		* Error boundary over the rail: a render failure must never blank silently —
		* it shows a dismissible strip and logs the stack.
		*/
		var RailBoundary = class extends react.Component {
			state = { error: null };
			static getDerivedStateFromError(error) {
				return { error: error instanceof Error ? error.message : String(error) };
			}
			componentDidCatch(error, info) {
				console.error("[dsh-turn-scrubber] rail render crash:", error, info);
			}
			render() {
				if (this.state.error !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						position: "absolute",
						right: 4,
						top: 8,
						zIndex: 2147483e3,
						maxWidth: 220,
						padding: "6px 10px",
						borderRadius: 8,
						background: "rgba(120,20,20,.92)",
						color: "#ffd9d9",
						font: "11px/1.5 ui-monospace,Menlo,monospace"
					},
					children: ["dsh-turn-scrubber: ", this.state.error]
				});
				return this.props.children;
			}
		};
		function apply(ctx) {
			const sessions = ctx.sessions;
			const connection = ctx.connection;
			let root = null;
			let mountEl = null;
			let scrollport = null;
			let boundSessionId;
			/** The session face currently bound (for cancel/teardown of load loops). */
			let boundSession;
			/** Latest host index applied to the rail (null = degrade to loaded-only). */
			let hostIndex = null;
			/** Last fingerprint we fetched the index for (skip identical refetches). */
			let fetchedFingerprint = "";
			/** Opaque token tied to the bound session — passed to ensureTurnLoaded. */
			let sessionToken = void 0;
			/** Session snapshot subscription (fingerprint growth → refresh index). */
			let offSnapshot = null;
			let lastAttachAttempt = 0;
			const renderRail = () => {
				if (root === null || mountEl === null || scrollport === null || boundSession === void 0) return;
				root.render((0, react.createElement)(RailBoundary, null, (0, react.createElement)(TurnRail, {
					session: boundSession,
					scrollport,
					hostIndex,
					token: sessionToken
				})));
			};
			/**
			* Fetch the host index for the bound session and apply it only when it still
			* matches the current binding (重要 3). Failures leave `hostIndex = null`
			* (rail degrades to loaded-only, INTERFACE §2.5).
			*/
			const refreshHostIndex = async () => {
				if (boundSessionId === void 0 || boundSession === void 0) return;
				const fingerprint = indexFingerprint(boundSession.snapshotCache.chat);
				if (fingerprint === fetchedFingerprint) return;
				fetchedFingerprint = fingerprint;
				const sessionId = boundSessionId;
				const result = await loadTurnIndex(connection, sessionId, boundSession.snapshotCache.chat);
				if (boundSessionId !== sessionId) return;
				hostIndex = result;
				renderRail();
			};
			/** Subscribe to snapshot changes: new turns grow the fingerprint → refresh. */
			const watchSnapshot = (session) => {
				offSnapshot?.();
				offSnapshot = session.subscribe(() => {
					refreshHostIndex();
				});
			};
			const teardown = (reason) => {
				if (boundSession !== void 0) cancelTurnLoads(boundSession);
				if (boundSessionId !== void 0) clearTurnIndexCache(boundSessionId);
				offSnapshot?.();
				offSnapshot = null;
				root?.unmount();
				root = null;
				mountEl?.remove();
				mountEl = null;
				scrollport = null;
				boundSession = void 0;
				boundSessionId = void 0;
				hostIndex = null;
				fetchedFingerprint = "";
				sessionToken = void 0;
			};
			/** Attach (or re-attach) the rail for the given session. Returns false if the DOM/session is not ready. */
			const attach = (sessionId) => {
				if (root !== null && scrollport?.isConnected && boundSessionId === sessionId) return true;
				teardown(`re-attach for session "${sessionId}"`);
				const sp = document.querySelector("[data-conversation-scroll]");
				if (!sp) {
					console.warn("[dsh-turn-scrubber] attach skipped: no [data-conversation-scroll] yet");
					return false;
				}
				const session = sessions.binding(sessionId)?.session;
				if (!session) {
					console.warn(`[dsh-turn-scrubber] attach skipped: no session binding for "${sessionId}"`);
					return false;
				}
				const parent = sp.parentElement;
				if (!parent) return false;
				if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
				mountEl = document.createElement("div");
				mountEl.style.cssText = "position:absolute;right:0;top:0;bottom:0;width:18px;z-index:45;pointer-events:none";
				parent.appendChild(mountEl);
				scrollport = sp;
				boundSessionId = sessionId;
				boundSession = session;
				sessionToken = {};
				root = (0, react_dom_client.createRoot)(mountEl);
				renderRail();
				watchSnapshot(session);
				refreshHostIndex();
				console.log(`[dsh-turn-scrubber] mounted for session "${sessionId}"`);
				return true;
			};
			const sync = () => {
				const current = sessions.list.getSnapshot().current;
				if (current === void 0) return;
				const now = Date.now();
				if (now - lastAttachAttempt < ATTACH_COOLDOWN_MS) return;
				lastAttachAttempt = now;
				attach(current);
			};
			const offList = sessions.list.subscribe(sync);
			const mo = new MutationObserver(() => {
				if (scrollport !== null && !scrollport.isConnected) {
					teardown("scrollport detached");
					sync();
					return;
				}
				if (root === null) sync();
			});
			mo.observe(document.body, {
				childList: true,
				subtree: true
			});
			sync();
			ctx.effect(() => () => {
				teardown("fiber dispose");
				cancelAllTurnLoads();
				resetTurnIndexCache();
				offList();
				mo.disconnect();
			}, "dsh-turn-scrubber: rail lifecycle");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
