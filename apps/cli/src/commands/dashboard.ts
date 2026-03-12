/**
 * Dashboard command: opens the gateway control UI in the default browser.
 */

import { openGatewayBrowserSurface } from "./open-browser-surface.js";

interface DashboardOptions {
	port?: string;
	host?: string;
	config?: string;
}

export async function runDashboardCommand(opts: DashboardOptions = {}): Promise<void> {
	await openGatewayBrowserSurface({
		...opts,
		path: "/ui",
	});
}
