/**
 * WebChat command: opens the gateway WebChat in the default browser.
 */

import { openGatewayBrowserSurface } from "./open-browser-surface.js";

interface WebChatOptions {
	port?: string;
	host?: string;
	config?: string;
}

export async function runWebChatCommand(opts: WebChatOptions = {}): Promise<void> {
	await openGatewayBrowserSurface({
		...opts,
		path: "/webchat",
	});
}
