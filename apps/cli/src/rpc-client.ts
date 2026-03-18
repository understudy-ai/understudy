/**
 * RPC client for communicating with a running Understudy gateway.
 */

import { randomUUID } from "node:crypto";

export interface RpcClientOptions {
	baseUrl?: string;
	host?: string;
	port?: number;
	token?: string;
	timeout?: number;
}

export interface RpcCallOptions {
	timeout?: number;
}

export class GatewayRpcClient {
	private baseUrl: string;
	private token?: string;
	private timeout: number;

	constructor(options: RpcClientOptions = {}) {
		const configuredBaseUrl = options.baseUrl?.trim();
		if (configuredBaseUrl) {
			this.baseUrl = configuredBaseUrl.replace(/\/+$/, "");
		} else {
			const host = options.host ?? "127.0.0.1";
			const port = options.port ?? 23333;
			this.baseUrl = `http://${host}:${port}`;
		}
		this.token = options.token ?? process.env.UNDERSTUDY_GATEWAY_TOKEN;
		this.timeout = options.timeout ?? 30_000;
	}

	/** Call an RPC method on the gateway */
	async call<T = unknown>(
		method: string,
		params: Record<string, unknown> = {},
		options: RpcCallOptions = {},
	): Promise<T> {
		const id = randomUUID();
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (this.token) {
			headers["Authorization"] = `Bearer ${this.token}`;
		}

		const controller = new AbortController();
		const timeoutMs = options.timeout ?? this.timeout;
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		try {
			const response = await fetch(`${this.baseUrl}/rpc`, {
				method: "POST",
				headers,
				body: JSON.stringify({ id, method, params }),
				signal: controller.signal,
			});

			if (response.status === 401) {
				throw new Error("Authentication failed. Check UNDERSTUDY_GATEWAY_TOKEN or --token.");
			}
			if (response.status === 429) {
				throw new Error("Rate limited. Try again later.");
			}
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const result = await response.json() as { id: string; result?: T; error?: { code: number; message: string } };
			if (result.error) {
				throw new Error(`RPC error ${result.error.code}: ${result.error.message}`);
			}
			return result.result as T;
		} finally {
			clearTimeout(timer);
		}
	}

	/** Fetch the health endpoint */
	async health(): Promise<Record<string, unknown>> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeout);
		try {
			const response = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}
			return await response.json() as Record<string, unknown>;
		} finally {
			clearTimeout(timer);
		}
	}

	get url(): string {
		return this.baseUrl;
	}
}

/** Create an RPC client with default config/env settings */
export function createRpcClient(options?: RpcClientOptions): GatewayRpcClient {
	const port = options?.port ?? parseInt(process.env.UNDERSTUDY_GATEWAY_PORT ?? "23333", 10);
	const host = options?.host ?? process.env.UNDERSTUDY_GATEWAY_HOST ?? "127.0.0.1";
	const token = options?.token ?? process.env.UNDERSTUDY_GATEWAY_TOKEN;
	return new GatewayRpcClient({ ...options, host, port, token });
}
