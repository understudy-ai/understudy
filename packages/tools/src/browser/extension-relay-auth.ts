import { createHmac } from "node:crypto";
import { asString, ConfigManager } from "@understudy/core";

const UNDERSTUDY_EXTENSION_RELAY_TOKEN_CONTEXT = "understudy-extension-relay-v1";
export const UNDERSTUDY_EXTENSION_RELAY_HEADER = "x-understudy-relay-token";
export const UNDERSTUDY_EXTENSION_RELAY_BROWSER = "Understudy/extension-relay";

export interface UnderstudyRelayAttachedTarget {
	id: string;
	type: string;
	title: string;
	url: string;
}

export interface UnderstudyRelayStatus {
	reachable: boolean;
	recognized: boolean;
	extensionConnected: boolean;
	attachedTargets: UnderstudyRelayAttachedTarget[];
	webSocketDebuggerUrl?: string;
	error?: string;
}

function parseRelayPort(value: string): number | null {
	try {
		const parsed = new URL(value.trim());
		const port =
			parsed.port.trim() !== ""
				? Number(parsed.port)
				: parsed.protocol === "https:"
					? 443
					: 80;
		if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
			return null;
		}
		const host = parsed.hostname.trim().toLowerCase();
		if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
			return null;
		}
		return port;
	} catch {
		return null;
	}
}

async function resolveGatewayAuthToken(options?: {
	gatewayToken?: string;
}): Promise<string | null> {
	const explicitToken = asString(options?.gatewayToken);
	if (explicitToken) {
		return explicitToken;
	}

	const envToken = asString(process.env.UNDERSTUDY_GATEWAY_TOKEN);
	if (envToken) {
		return envToken;
	}

	try {
		const config = await ConfigManager.load();
		return asString(config.get().gateway?.auth?.token) ?? null;
	} catch {
		return null;
	}
}

function deriveRelayAuthToken(gatewayToken: string, port: number): string {
	return createHmac("sha256", gatewayToken)
		.update(`${UNDERSTUDY_EXTENSION_RELAY_TOKEN_CONTEXT}:${port}`)
		.digest("hex");
}

export async function resolveUnderstudyRelayAcceptedTokensForPort(
	port: number,
	options?: {
		gatewayToken?: string;
	},
): Promise<string[]> {
	const gatewayToken = await resolveGatewayAuthToken(options);
	if (!gatewayToken) {
		throw new Error(
			"Browser extension relay requires gateway auth token. Set gateway.auth.token or UNDERSTUDY_GATEWAY_TOKEN.",
		);
	}
	const relayToken = deriveRelayAuthToken(gatewayToken, port);
	if (relayToken === gatewayToken) {
		return [relayToken];
	}
	return [relayToken, gatewayToken];
}

export async function resolveUnderstudyRelayAuthTokenForPort(
	port: number,
	options?: {
		gatewayToken?: string;
	},
): Promise<string> {
	return (await resolveUnderstudyRelayAcceptedTokensForPort(port, options))[0];
}

export async function getUnderstudyChromeExtensionRelayAuthHeaders(
	url: string,
	options?: {
		gatewayToken?: string;
	},
): Promise<Record<string, string>> {
	const port = parseRelayPort(url);
	if (!port) {
		return {};
	}
	return {
		[UNDERSTUDY_EXTENSION_RELAY_HEADER]: await resolveUnderstudyRelayAuthTokenForPort(port, options),
	};
}

export async function probeAuthenticatedUnderstudyRelay(params: {
	baseUrl: string;
	timeoutMs?: number;
	gatewayToken?: string;
}): Promise<boolean> {
	const status = await inspectAuthenticatedUnderstudyRelay(params);
	return status.reachable && status.recognized;
}

async function fetchRelayJson(
	baseUrl: string,
	path: string,
	headers: Record<string, string>,
	timeoutMs: number,
): Promise<{ ok: boolean; status: number; body?: unknown; error?: string }> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(new URL(path, `${baseUrl}/`).toString(), {
			signal: controller.signal,
			headers,
		});
		if (!response.ok) {
			return { ok: false, status: response.status };
		}
		return {
			ok: true,
			status: response.status,
			body: await response.json(),
		};
	} catch (error) {
		return {
			ok: false,
			status: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}

export async function inspectAuthenticatedUnderstudyRelay(params: {
	baseUrl: string;
	timeoutMs?: number;
	gatewayToken?: string;
}): Promise<UnderstudyRelayStatus> {
	const timeoutMs = params.timeoutMs ?? 500;
	const port = parseRelayPort(params.baseUrl);
	if (!port) {
		return {
			reachable: false,
			recognized: false,
			extensionConnected: false,
			attachedTargets: [],
			error: "Invalid relay URL",
		};
	}

	const headers = await getUnderstudyChromeExtensionRelayAuthHeaders(params.baseUrl, {
		gatewayToken: params.gatewayToken,
	}).catch(() => ({}));
	const version = await fetchRelayJson(params.baseUrl, "/json/version", headers, timeoutMs);
	if (!version.ok) {
		return {
			reachable: false,
			recognized: false,
			extensionConnected: false,
			attachedTargets: [],
			error: version.error ?? `HTTP ${version.status}`,
		};
	}

	const versionBody = (version.body ?? {}) as {
		Browser?: unknown;
		webSocketDebuggerUrl?: unknown;
	};
	const recognized = versionBody.Browser === UNDERSTUDY_EXTENSION_RELAY_BROWSER;
	const status = await fetchRelayJson(params.baseUrl, "/extension/status", headers, timeoutMs);
	const list = await fetchRelayJson(params.baseUrl, "/json/list", headers, timeoutMs);
	const rawTargets = Array.isArray(list.body) ? list.body : [];

	return {
		reachable: true,
		recognized,
		extensionConnected: Boolean(
			status.ok &&
			status.body &&
			typeof status.body === "object" &&
			(status.body as { connected?: unknown }).connected === true,
		),
		attachedTargets: rawTargets
			.filter((target): target is {
				id?: unknown;
				type?: unknown;
				title?: unknown;
				url?: unknown;
			} => Boolean(target && typeof target === "object"))
			.map((target) => ({
				id: typeof target.id === "string" ? target.id : "",
				type: typeof target.type === "string" ? target.type : "page",
				title: typeof target.title === "string" ? target.title : "",
				url: typeof target.url === "string" ? target.url : "",
			})),
		webSocketDebuggerUrl:
			typeof versionBody.webSocketDebuggerUrl === "string" ? versionBody.webSocketDebuggerUrl : undefined,
	};
}
