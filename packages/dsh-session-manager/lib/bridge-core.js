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
export { postJson };
