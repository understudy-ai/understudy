import { createRpcClient } from "../rpc-client.js";

interface BrowserOptions {
	status?: boolean;
	start?: boolean;
	stop?: boolean;
	tabs?: boolean;
	open?: string;
	focus?: string;
	navigate?: string;
	screenshot?: boolean;
	snapshot?: boolean;
	fn?: string;
	close?: string;
	mode?: string;
	managed?: boolean;
	extension?: string | boolean;
	cdpUrl?: string;
	json?: boolean;
	port?: string;
	host?: string;
}

function wantsImplicitStart(opts: BrowserOptions): boolean {
	if (!(opts.extension || opts.managed || opts.mode)) {
		return false;
	}
	return ![
		opts.stop,
		opts.tabs,
		opts.open,
		opts.focus,
		opts.navigate,
		opts.screenshot,
		opts.snapshot,
		opts.fn,
		opts.close,
		opts.status,
	].some(Boolean);
}

function stringifyResult(result: unknown): string {
	if (!result || typeof result !== "object") {
		return String(result ?? "");
	}
	const record = result as Record<string, unknown>;
	if (typeof record.text === "string" && record.text.trim().length > 0) {
		return record.text;
	}
	return JSON.stringify(result, null, 2);
}

export async function runBrowserCommand(opts: BrowserOptions = {}): Promise<void> {
	const client = createRpcClient({
		host: opts.host,
		port: opts.port ? parseInt(opts.port, 10) : undefined,
	});

	const request = async (params: Record<string, unknown>) =>
		await client.call<Record<string, unknown>>("browser.request", params);

	const connectionMode = (() => {
		if (opts.extension) return "extension";
		if (opts.managed) return "managed";
		if (opts.mode?.trim()) return opts.mode.trim();
		return undefined;
	})();

	const cdpUrl = typeof opts.extension === "string" ? opts.extension : opts.cdpUrl;

	const browserConfig = {
		...(connectionMode ? { browserConnectionMode: connectionMode } : {}),
		...(cdpUrl?.trim() ? { browserCdpUrl: cdpUrl.trim() } : {}),
	};

	try {
		let result: Record<string, unknown>;
		if (opts.start || wantsImplicitStart(opts)) {
			result = await request({ action: "start", ...browserConfig });
		} else if (opts.stop) {
			result = await request({ action: "stop", ...browserConfig });
		} else if (opts.tabs) {
			result = await request({ action: "tabs", ...browserConfig });
		} else if (opts.open) {
			result = await request({ action: "open", url: opts.open, ...browserConfig });
		} else if (opts.focus) {
			result = await request({ action: "focus", targetId: opts.focus, ...browserConfig });
		} else if (opts.navigate) {
			result = await request({ action: "navigate", url: opts.navigate, ...browserConfig });
		} else if (opts.screenshot) {
			result = await request({ action: "screenshot", ...browserConfig });
		} else if (opts.snapshot) {
			result = await request({ action: "snapshot", ...browserConfig });
		} else if (opts.fn) {
			result = await request({ action: "evaluate", fn: opts.fn, ...browserConfig });
		} else if (opts.close) {
			result = await request({ action: "close", targetId: opts.close, ...browserConfig });
		} else {
			result = await request({ action: "status", ...browserConfig });
		}

		if (opts.json) {
			console.log(JSON.stringify(result, null, 2));
			return;
		}
		console.log(stringifyResult(result));
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
