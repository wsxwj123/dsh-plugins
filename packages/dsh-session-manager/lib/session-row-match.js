//#region src/client/sessionRowMatch.ts
/** Max title length a candidate may match (mirrors the host's 256 limit). */
const MAX_TITLE_LEN = 256;
/** The longest non-blank title contained in the label (per-row primitive). */
function bestTitleIn(label, byId) {
	let best = null;
	for (const id of Object.keys(byId)) {
		const s = byId[id];
		if (!s || s.blank) continue;
		const candidate = s.title ?? s.displayTitle ?? "";
		if (!candidate) continue;
		if (candidate.length === 0 || candidate.length > MAX_TITLE_LEN) continue;
		if (!label.includes(candidate)) continue;
		if (best === null || candidate.length > best.length) best = candidate;
	}
	return best;
}
/** Resolve ONE session id from a single row-actions aria-label. Ties fall back
*  to the first byId key — use `resolveRows` for a whole container so same-title
*  rows bind distinct ids (review I-6). */
function matchSessionFromLabel(label, byId) {
	const title = bestTitleIn(label, byId);
	if (title === null) return null;
	for (const id of Object.keys(byId)) {
		const s = byId[id];
		if (!s || s.blank) continue;
		if ((s.title ?? s.displayTitle ?? "") === title) return {
			id,
			cwd: s.cwd,
			title,
			running: s.running === true
		};
	}
	return null;
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
		if (!title || title.length === 0 || title.length > MAX_TITLE_LEN) continue;
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
export { matchSessionFromLabel, resolveRows };
