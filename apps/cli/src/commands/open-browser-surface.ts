import { resolveGatewayBrowserToken } from "./gateway-browser-auth.js";
import { openExternalPath } from "./open-path.js";

interface OpenBrowserSurfaceOptions {
	port?: string;
	host?: string;
	config?: string;
	path: "/ui" | "/webchat";
}

export async function openGatewayBrowserSurface(opts: OpenBrowserSurfaceOptions): Promise<void> {
	const port = opts.port ?? "23333";
	const host = opts.host ?? "127.0.0.1";
	const token = await resolveGatewayBrowserToken(opts.config);
	const url = token
		? `http://${host}:${port}${opts.path}?token=${encodeURIComponent(token)}`
		: `http://${host}:${port}${opts.path}`;

	console.log(`Opening ${url} ...`);
	const result = await openExternalPath(url);
	if (!result.ok) {
		console.log(`Could not open browser. Visit: ${url}`);
	}
}
