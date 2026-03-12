/**
 * Pairing RPC handlers: pairing.request, pairing.approve
 */

import type { RpcHandler } from "../handler-registry.js";

export const pairingRequest: RpcHandler = async (request, context) => {
	const channelId = request.params.channelId as string;
	if (!channelId) {
		return { id: request.id, error: { code: 400, message: "channelId required" } };
	}
	const code = context.getPairingManager().generateCode(channelId);
	return { id: request.id, result: { code } };
};

export const pairingApprove: RpcHandler = async (request, context) => {
	const { code, channelId, senderId } = request.params as {
		code: string;
		channelId: string;
		senderId: string;
	};
	const approved = context.getPairingManager().approve(code, channelId, senderId);
	return { id: request.id, result: { approved } };
};

export const pairingReject: RpcHandler = async (request, context) => {
	const { code, channelId } = request.params as {
		code: string;
		channelId?: string;
	};
	if (!code || typeof code !== "string") {
		return { id: request.id, error: { code: 400, message: "code is required" } };
	}
	const rejected = context.getPairingManager().reject(code, channelId);
	return { id: request.id, result: { rejected } };
};
