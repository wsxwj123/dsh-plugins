//#region src/client/sessionRowMatch.ts
/** Resolve one session id from a single row-actions aria-label. */
function matchSessionFromLabel(label, byId) {
	let best = null;
	let bestId;
	let bestRunning = false;
	let bestCwd = "";
	for (const id of Object.keys(byId)) {
		const s = byId[id];
		if (!s || s.blank) continue;
		const candidate = s.title ?? s.displayTitle ?? "";
		if (!candidate) continue;
		if (candidate.length === 0 || candidate.length > 256) continue;
		if (!label.includes(candidate)) continue;
		if (best === null || candidate.length > best.length) {
			best = candidate;
			bestId = id;
			bestRunning = s.running === true;
			bestCwd = String(s.cwd ?? "");
		}
	}
	if (best === null || bestId === void 0) return null;
	return {
		id: bestId,
		cwd: bestCwd,
		title: best,
		running: bestRunning
	};
}
//#endregion
export { matchSessionFromLabel };
