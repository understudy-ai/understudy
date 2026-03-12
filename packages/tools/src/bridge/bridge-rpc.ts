import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { asString } from "@understudy/core";

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:23333";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface BridgeGatewayOptions {
	gatewayUrl?: string;
	gatewayToken?: string;
	timeoutMs?: number;
}

interface GatewayRpcPayload<T> {
	result?: T;
	error?: {
		code?: number;
		message?: string;
	};
}

function normalizeGatewayUrl(value: string | undefined): string {
	const resolved = asString(value) ?? DEFAULT_GATEWAY_URL;
	return resolved.replace(/\/$/, "");
}

function normalizeGatewayToken(value: string | undefined): string | undefined {
	return asString(value);
}

function normalizeTimeout(value: number | undefined): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_TIMEOUT_MS;
	}
	return Math.floor(value);
}

function resolveRequestId(): string {
	return `tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveGatewayOptions(
	params: BridgeGatewayOptions,
	defaults?: BridgeGatewayOptions,
): Required<BridgeGatewayOptions> {
	const gatewayUrl = normalizeGatewayUrl(
		defaults?.gatewayUrl ?? params.gatewayUrl ?? process.env.UNDERSTUDY_GATEWAY_URL,
	);
	const gatewayToken = normalizeGatewayToken(
		defaults?.gatewayToken ?? params.gatewayToken ?? process.env.UNDERSTUDY_GATEWAY_TOKEN,
	) ?? "";
	const timeoutMs = normalizeTimeout(params.timeoutMs ?? defaults?.timeoutMs);
	return {
		gatewayUrl,
		gatewayToken,
		timeoutMs,
	};
}

async function parseRpcPayload<T>(response: Response): Promise<GatewayRpcPayload<T>> {
	const text = await response.text();
	if (!text.trim()) {
		return {};
	}
	try {
		return JSON.parse(text) as GatewayRpcPayload<T>;
	} catch {
		return {
			error: {
				message: text.slice(0, 500),
			},
		};
	}
}

export async function callGatewayRpc<T>(
	method: string,
	params: Record<string, unknown>,
	options: BridgeGatewayOptions,
): Promise<T> {
	const resolved = resolveGatewayOptions(options);
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (resolved.gatewayToken) {
		headers.authorization = `Bearer ${resolved.gatewayToken}`;
		headers["x-auth-token"] = resolved.gatewayToken;
	}

	const signal =
		typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
			? AbortSignal.timeout(resolved.timeoutMs)
			: undefined;

	const response = await fetch(`${resolved.gatewayUrl}/rpc`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			id: resolveRequestId(),
			method,
			params,
		}),
		signal,
	});
	const payload = await parseRpcPayload<T>(response);

	if (!response.ok) {
		const message = payload.error?.message ?? `Gateway request failed (${response.status})`;
		throw new Error(message);
	}
	if (payload.error) {
		throw new Error(payload.error.message ?? `Gateway RPC failed: ${method}`);
	}
	return payload.result as T;
}

export function textResult(text: string, details: Record<string, unknown> = {}): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

export function jsonResult(result: unknown, details: Record<string, unknown> = {}): AgentToolResult<unknown> {
	let text: string;
	if (typeof result === "string") {
		text = result;
	} else {
		text = JSON.stringify(result, null, 2);
	}
	return textResult(text, {
		...details,
		result,
	});
}

export function errorResult(
	prefix: string,
	error: unknown,
	details: Record<string, unknown> = {},
): AgentToolResult<unknown> {
	const message = error instanceof Error ? error.message : String(error);
	return textResult(`${prefix}: ${message}`, {
		...details,
		error: message,
	});
}
