import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type UnderstudyConfig } from "@understudy/types";
import {
	buildGatewayChannelConfigOverride,
	mergeUnderstudyConfigOverride,
	shouldApplyPrivateChannelToolPreset,
} from "@understudy/gateway";

function createConfig(overrides: Partial<UnderstudyConfig> = {}): UnderstudyConfig {
	return {
		...DEFAULT_CONFIG,
		...overrides,
		agent: {
			...DEFAULT_CONFIG.agent,
			...overrides.agent,
		},
		channels: {
			...DEFAULT_CONFIG.channels,
			...overrides.channels,
		},
		tools: {
			...DEFAULT_CONFIG.tools,
			...overrides.tools,
		},
	};
}

describe("gateway-channel-policy", () => {
	it("does not apply the conservative preset to private messaging channels by default", () => {
		const config = createConfig({
			channels: {
				telegram: {
					enabled: true,
					settings: {},
				},
			},
			tools: {
				policies: [{ match: ["web_search"], action: "allow" }],
				autoApproveReadOnly: true,
			},
		});

		const override = buildGatewayChannelConfigOverride({
			config,
			channelId: "telegram",
			conversationType: "direct",
		});

		expect(override).toBeUndefined();
	});

	it("applies the conservative preset when explicitly enabled", () => {
		const config = createConfig({
			channels: {
				telegram: {
					enabled: true,
					settings: {},
					toolPolicyPreset: "private_conservative",
				},
			},
			tools: {
				policies: [{ match: ["web_search"], action: "allow" }],
				autoApproveReadOnly: true,
			},
		});

		const override = buildGatewayChannelConfigOverride({
			config,
			channelId: "telegram",
			conversationType: "direct",
		});

		expect(override?.tools?.policies).toEqual([
			{ match: ["web_search"], action: "allow" },
			{ match: ["risk:write", "risk:dangerous"], action: "require_approval" },
			{
				match: [
					"category:shell",
					"category:process",
					"category:browser",
					"category:gui",
					"category:messaging",
					"category:schedule",
				],
				action: "require_approval",
			},
		]);
		expect(override?.agent?.safetyInstructions).toContain("Private channel safety:");
	});

	it("lets explicit channel policies coexist with the conservative preset", () => {
		const config = createConfig({
			channels: {
				telegram: {
					enabled: true,
					settings: {},
					toolPolicyPreset: "private_conservative",
					toolPolicies: [{ match: ["category:messaging"], action: "allow" }],
				},
			},
		});

		const override = buildGatewayChannelConfigOverride({
			config,
			channelId: "telegram",
			conversationType: "direct",
		});

		expect(override?.tools?.policies?.[0]).toEqual({
			match: ["category:messaging"],
			action: "allow",
		});
	});

	it("can disable the conservative preset per channel", () => {
		const config = createConfig({
			channels: {
				telegram: {
					enabled: true,
					settings: {},
					toolPolicyPreset: "off",
				},
			},
		});

		expect(
			shouldApplyPrivateChannelToolPreset("telegram", config.channels.telegram, "direct"),
		).toBe(false);
		const override = buildGatewayChannelConfigOverride({
			config,
			channelId: "telegram",
			conversationType: "direct",
		});
		expect(override).toBeUndefined();
	});

	it("does not auto-apply the private preset to group conversations on mixed channels", () => {
		const config = createConfig({
			channels: {
				slack: {
					enabled: true,
					settings: {},
				},
			},
		});

		expect(
			shouldApplyPrivateChannelToolPreset("slack", config.channels.slack, "group"),
		).toBe(false);
		expect(
			buildGatewayChannelConfigOverride({
				config,
				channelId: "slack",
				conversationType: "group",
			}),
		).toBeUndefined();
	});

	it("does not apply the conservative preset when conversation metadata is absent", () => {
		const config = createConfig({
			channels: {
				imessage: {
					enabled: true,
					settings: {},
				},
			},
		});

		expect(shouldApplyPrivateChannelToolPreset("imessage", config.channels.imessage)).toBe(false);
	});

	it("merges partial config overrides without dropping nested channel settings", () => {
		const merged = mergeUnderstudyConfigOverride(
			{
				channels: {
					telegram: {
						enabled: true,
						settings: { botToken: "a" },
					},
				},
			},
			{
				channels: {
					telegram: {
						enabled: true,
						settings: { allowedChatIds: ["1"] },
						toolPolicies: [{ match: ["category:shell"], action: "require_approval" }],
					},
				},
			},
		);

		expect(merged?.channels?.telegram).toEqual({
			enabled: true,
			settings: {
				botToken: "a",
				allowedChatIds: ["1"],
			},
			toolPolicies: [{ match: ["category:shell"], action: "require_approval" }],
		});
	});
});
