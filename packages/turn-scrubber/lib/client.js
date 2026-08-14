window.__ModuleLoader__.load({
	id: "dsh-turn-scrubber",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region \0dsh-css:src/client/rail.module.css.mjs
		const css = ".Sr0Veq_rail{z-index:45;pointer-events:auto;width:18px;position:absolute;right:6px}.Sr0Veq_group{pointer-events:auto;flex-direction:column;align-items:flex-end;padding:0 0 0 14px;display:flex;position:absolute;right:0}.Sr0Veq_line{cursor:pointer;background:0 0;border:none;justify-content:flex-end;align-items:center;margin:0;padding:0;display:flex}.Sr0Veq_bar{transform-origin:100%;will-change:transform;border-radius:1px;flex:none;height:2px;transition:transform 90ms ease-out,background-color .16s,opacity .16s;display:block}.Sr0Veq_tip{border:1px solid var(--dsw-alias-border-l2,#8080804d);background:var(--dsw-alias-bg-overlay,#18181cf0);width:max-content;max-width:280px;box-shadow:var(--dsw-shadow-lv2,0 4px 16px #00000059);pointer-events:auto;color:var(--dsw-alias-label-primary,#e8e8ec);font-family:var(--dsw-font-body,system-ui, sans-serif);border-radius:8px;padding:6px 10px;font-size:12px;line-height:1.45;animation:.14s ease-out Sr0Veq_tip-in;position:absolute;transform:translateY(-50%)}@keyframes Sr0Veq_tip-in{0%{opacity:0;transform:translateY(-50%)translate(5px)}to{opacity:1;transform:translateY(-50%)translate(0)}}.Sr0Veq_tipTitle{color:var(--dsw-alias-label-tertiary,#c8c8d299);margin-bottom:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px}.Sr0Veq_tipText{-webkit-line-clamp:2;word-break:break-word;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}@media (width<=767px){.Sr0Veq_rail{display:none}}";
		const tagId = "dsh-turn-scrubber/rail.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-turn-scrubber";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var rail_module_css_default = {
			"group": "Sr0Veq_group",
			"bar": "Sr0Veq_bar",
			"tipTitle": "Sr0Veq_tipTitle",
			"tip": "Sr0Veq_tip",
			"tip-in": "Sr0Veq_tip-in",
			"tipText": "Sr0Veq_tipText",
			"line": "Sr0Veq_line",
			"rail": "Sr0Veq_rail"
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
		/** Collect user turns from the chat snapshot: turn id, first-user-node key, text. */
		function collectTurns(chat) {
			if (!chat) return [];
			const turnKeys = chat.locations?.turns;
			if (!turnKeys) return [];
			const turns = [];
			for (const keys of turnKeys.values()) {
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
				turns.push({
					key: nodeKey,
					text: textOfContent(node?.data?.content)
				});
			}
			return turns;
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
		function TurnRail({ session, scrollport }) {
			const snap = (0, react.useSyncExternalStore)((0, react.useCallback)((cb) => session.subscribe(cb), [session]), (0, react.useCallback)(() => session.snapshotCache, [session]));
			const turns = (0, react.useMemo)(() => collectTurns(snap?.chat), [snap]);
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
			if (!box || turns.length < 2) return null;
			const count = turns.length;
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
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: rail_module_css_default.rail,
				style: {
					top: box.top,
					height: areaH
				},
				onMouseMove: (e) => enter(hoverFromPointer(e.clientY)),
				onMouseLeave: park,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					ref: groupRef,
					className: rail_module_css_default.group,
					style: {
						top: groupTop,
						gap
					},
					children: turns.map((t, i) => {
						const d = hoverPos === null ? Infinity : i - hoverPos;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: rail_module_css_default.line,
							style: { height: HIT },
							onClick: () => {
								const row = scrollport.querySelector(`[data-chat-anchor-key="${CSS.escape(t.key)}"]`);
								if (row) scrollToRow(scrollport, row);
							},
							"aria-label": `跳到第 ${i + 1} 个回合`,
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: rail_module_css_default.bar,
								style: {
									width: Math.round(width),
									transform: `scaleX(${waveScale(d)})`,
									opacity: waveGlow(d),
									background: d < .5 && d > -.5 ? "var(--dsw-alias-label-primary)" : "var(--dsw-alias-label-secondary)"
								}
							})
						}, t.key);
					})
				}), tip !== null && turns[tip] && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: rail_module_css_default.tip,
					style: {
						top: groupTop + tip * (HIT + gap) + HIT / 2,
						right: width + 12
					},
					onMouseEnter: keepAlive,
					onMouseLeave: park,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: rail_module_css_default.tipTitle,
						children: ["回合 ", tip + 1]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: rail_module_css_default.tipText,
						children: (turns[tip].text || "(空消息)").slice(0, 200)
					})]
				})]
			});
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
		*/
		/** Services required before mounting (provided by the client runtime). */
		const inject = ["sessions"];
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
			let root = null;
			let mountEl = null;
			let scrollport = null;
			let boundSessionId;
			let lastAttachAttempt = 0;
			const teardown = (reason) => {
				console.warn(`[dsh-turn-scrubber] teardown: ${reason}`);
				root?.unmount();
				root = null;
				mountEl?.remove();
				mountEl = null;
				scrollport = null;
				boundSessionId = void 0;
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
				root = (0, react_dom_client.createRoot)(mountEl);
				root.render((0, react.createElement)(RailBoundary, null, (0, react.createElement)(TurnRail, {
					session,
					scrollport: sp
				})));
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
