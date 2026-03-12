/**
 * Channel RPC handlers: channel.list, channel.status, channel.logout
 */

import type { RpcHandler } from "../handler-registry.js";

export const channelList: RpcHandler = async (request, context) => {
	const channels = await context.getRouter().listChannelRuntimeStatuses();
	return {
		id: request.id,
		result: channels.map(({ channel, runtime }) => ({
			id: channel.id,
			name: channel.name,
			capabilities: channel.capabilities,
			runtime,
		})),
	};
};

export const channelStatus: RpcHandler = async (request, context) => {
	const channelId = request.params.channelId as string | undefined;
	if (!channelId) {
		return { id: request.id, error: { code: 400, message: "channelId is required" } };
	}
	const channel = context.getRouter().getChannel(channelId);
	if (!channel) {
		return { id: request.id, error: { code: 404, message: `Unknown channel: ${channelId}` } };
	}
	const runtime = await context.getRouter().getChannelRuntimeStatus(channelId);
	return {
		id: request.id,
		result: {
			id: channel.id,
			name: channel.name,
			capabilities: channel.capabilities,
			runtime,
		},
	};
};

export const channelLogout: RpcHandler = async (request, context) => {
	const channelId = request.params.channelId as string | undefined;
	if (!channelId) {
		return { id: request.id, error: { code: 400, message: "channelId is required" } };
	}
	const router = context.getRouter();
	const channel = router.getChannel(channelId);
	if (!channel) {
		return { id: request.id, error: { code: 404, message: `Unknown channel: ${channelId}` } };
	}
	try {
		if (channel.auth?.logout) {
			await channel.auth.logout();
		}
		await channel.stop();
		router.removeChannel(channelId);
		return { id: request.id, result: { channelId, loggedOut: true } };
	} catch (error: any) {
		return { id: request.id, error: { code: 500, message: error.message } };
	}
};
