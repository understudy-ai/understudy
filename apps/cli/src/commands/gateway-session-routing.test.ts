import { describe, expect, it } from "vitest";
import {
	buildGatewayBaseSessionKey,
	resolveGatewaySessionRoute,
} from "./gateway-session-routing.js";

describe("gateway session routing", () => {
	it("routes plain turns to the active session for the conversation scope", () => {
		const baseSessionKey = buildGatewayBaseSessionKey({
			scope: "channel_sender",
			dmScope: "sender",
			channelId: "telegram",
			senderId: "user-1",
		});

		const resolved = resolveGatewaySessionRoute({
			scope: "channel_sender",
			dmScope: "sender",
			channelId: "telegram",
			senderId: "user-1",
			activeSessionId: `${baseSessionKey}:resume-123`,
		});

		expect(resolved).toMatchObject({
			baseSessionKey,
			sessionKey: `${baseSessionKey}:resume-123`,
			shouldPromoteToActive: true,
		});
	});

	it("creates a fresh scoped session id for forceNew when no execution scope was supplied", () => {
		const resolved = resolveGatewaySessionRoute({
			scope: "channel_sender",
			dmScope: "sender",
			channelId: "telegram",
			senderId: "user-1",
			forceNew: true,
			generateExecutionScopeKey: () => "fresh-scope",
		});

		expect(resolved).toMatchObject({
			baseSessionKey: "channel_sender:telegram:user-1",
			sessionKey: "channel_sender:telegram:user-1:fresh-scope",
			executionScopeKey: "fresh-scope",
			shouldPromoteToActive: true,
		});
	});

	it("prefers explicit execution scopes over any active-session binding", () => {
		const resolved = resolveGatewaySessionRoute({
			scope: "channel_sender",
			dmScope: "sender",
			channelId: "telegram",
			senderId: "user-1",
			executionScopeKey: "cp:ops:strict",
			activeSessionId: "channel_sender:telegram:user-1:stale-active",
		});

		expect(resolved).toMatchObject({
			baseSessionKey: "channel_sender:telegram:user-1",
			sessionKey: "channel_sender:telegram:user-1:cp:ops:strict",
			executionScopeKey: "cp:ops:strict",
			shouldPromoteToActive: false,
		});
	});
});
