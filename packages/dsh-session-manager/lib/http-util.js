//#region src/http-util.ts
/**
* Host/authority parsing helpers for the trust fence, ported verbatim from
* dsh-client-connection/lib/index.js so the /sm fence behaves identically to
* the official `/api` fence.
*/
/**
* Whether a WHATWG URL hostname names the local loopback authority
* (localhost, IPv6 ::1, or any IPv4 literal in 127/8).
*/
function isLoopbackHostname(hostname) {
	if (hostname === "localhost" || hostname === "[::1]") return true;
	const parts = hostname.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/**
* Normalized WHATWG URL of a Host-header authority, or undefined when it
* cannot be parsed as an authority (e.g. it carries encoded junk or a scheme).
*/
function parseAuthority(authority) {
	try {
		const url = new URL(`http://${authority}`);
		return {
			hostname: url.hostname,
			host: url.host
		};
	} catch {
		return;
	}
}
//#endregion
export { isLoopbackHostname, parseAuthority };
