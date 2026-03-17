import { randomUUID } from "node:crypto";
import { buildSessionKey } from "@understudy/gateway";

type SessionScope = "global" | "channel" | "sender" | "channel_sender";
type DmScope = "sender" | "thread";

type GatewaySessionRouteParams = {
	scope: SessionScope;
	dmScope: DmScope;
	channelId?: string;
	senderId?: string;
	threadId?: string;
	workspaceScopeDiscriminator?: string;
	executionScopeKey?: string;
	forceNew?: boolean;
	activeSessionId?: string;
	generateExecutionScopeKey?: () => string;
};

export type GatewaySessionRouteResolution = {
	baseSessionKey: string;
	sessionKey: string;
	executionScopeKey?: string;
	shouldPromoteToActive: boolean;
};

function joinScopeDiscriminator(parts: Array<string | undefined>): string | undefined {
	const filtered = parts
		.map((part) => part?.trim())
		.filter((part): part is string => typeof part === "string" && part.length > 0);
	return filtered.length > 0 ? filtered.join(":") : undefined;
}

export function buildGatewayBaseSessionKey(params: {
	scope: SessionScope;
	dmScope: DmScope;
	channelId?: string;
	senderId?: string;
	threadId?: string;
	workspaceScopeDiscriminator?: string;
}): string {
	return buildSessionKey({
		scope: params.scope,
		dmScope: params.dmScope,
		channelId: params.channelId,
		senderId: params.senderId,
		threadId: params.threadId,
		scopeDiscriminator: joinScopeDiscriminator([params.workspaceScopeDiscriminator]),
	});
}

export function buildGatewayScopedSessionKey(params: {
	scope: SessionScope;
	dmScope: DmScope;
	channelId?: string;
	senderId?: string;
	threadId?: string;
	workspaceScopeDiscriminator?: string;
	executionScopeKey?: string;
}): string {
	return buildSessionKey({
		scope: params.scope,
		dmScope: params.dmScope,
		channelId: params.channelId,
		senderId: params.senderId,
		threadId: params.threadId,
		scopeDiscriminator: joinScopeDiscriminator([
			params.executionScopeKey,
			params.workspaceScopeDiscriminator,
		]),
	});
}

export function createGatewayExecutionScopeKey(): string {
	return randomUUID();
}

export function resolveGatewaySessionRoute(
	params: GatewaySessionRouteParams,
): GatewaySessionRouteResolution {
	const baseSessionKey = buildGatewayBaseSessionKey(params);
	let executionScopeKey = params.executionScopeKey?.trim() || undefined;

	if (params.forceNew && !executionScopeKey) {
		executionScopeKey = (params.generateExecutionScopeKey ?? createGatewayExecutionScopeKey)();
	}

	if (executionScopeKey) {
		return {
			baseSessionKey,
			sessionKey: buildGatewayScopedSessionKey({
				...params,
				executionScopeKey,
			}),
			executionScopeKey,
			shouldPromoteToActive: params.forceNew === true || !params.executionScopeKey,
		};
	}

	if (params.activeSessionId?.trim()) {
		return {
			baseSessionKey,
			sessionKey: params.activeSessionId,
			shouldPromoteToActive: true,
		};
	}

	return {
		baseSessionKey,
		sessionKey: baseSessionKey,
		shouldPromoteToActive: true,
	};
}
