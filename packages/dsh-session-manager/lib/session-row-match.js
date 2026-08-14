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
export { matchSessionFromLabel, resolveRows };
