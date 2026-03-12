/**
 * HandlerRegistry: extensible RPC method dispatch.
 * Replaces the switch-case in GatewayServer with a registry pattern.
 */

import type { GatewayRequest, GatewayResponse } from "./protocol.js";

export interface HandlerContext {
	/** Access to GatewayServer internals via getter functions */
	getRouter: () => import("./router.js").MessageRouter;
	getPairingManager: () => import("./security.js").PairingManager;
	getChatHandler: () => import("./server.js").ChatHandler | null;
	getSessionHandlers: () => import("./server.js").SessionHandlers | null;
}

export type RpcHandler = (
	request: GatewayRequest,
	context: HandlerContext,
) => Promise<GatewayResponse>;

export class HandlerRegistry {
	private handlers = new Map<string, RpcHandler>();

	/** Register a handler for an RPC method */
	register(method: string, handler: RpcHandler): void {
		this.handlers.set(method, handler);
	}

	/** Get handler for a method */
	get(method: string): RpcHandler | undefined {
		return this.handlers.get(method);
	}

	/** Check if a method is registered */
	has(method: string): boolean {
		return this.handlers.has(method);
	}

	/** List all registered methods */
	listMethods(): string[] {
		return Array.from(this.handlers.keys());
	}

	/** Dispatch an RPC request to the appropriate handler */
	async dispatch(request: GatewayRequest, context: HandlerContext): Promise<GatewayResponse> {
		const handler = this.handlers.get(request.method);
		if (!handler) {
			return {
				id: request.id,
				error: { code: 404, message: `Unknown method: ${request.method}` },
			};
		}
		try {
			return await handler(request, context);
		} catch (error: unknown) {
			return {
				id: request.id,
				error: { code: 500, message: error instanceof Error ? error.message : "Internal error" },
			};
		}
	}

	/** Number of registered handlers */
	get size(): number {
		return this.handlers.size;
	}
}
