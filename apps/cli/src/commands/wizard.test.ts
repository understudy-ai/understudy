import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type UnderstudyConfig } from "@understudy/types";
import {
	buildWizardSummary,
	normalizeThinkingLevel,
	parseCommaList,
} from "./wizard.js";

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
		memory: {
			...DEFAULT_CONFIG.memory,
			...overrides.memory,
		},
	};
}

describe("wizard helpers", () => {
	it("parses comma-separated lists", () => {
		expect(parseCommaList("a,b,c")).toEqual(["a", "b", "c"]);
		expect(parseCommaList(" 1, 2 , , 3 ")).toEqual(["1", "2", "3"]);
		expect(parseCommaList("   ")).toBeUndefined();
	});

	it("normalizes thinking level and falls back on invalid input", () => {
		expect(normalizeThinkingLevel("HIGH", "off")).toBe("high");
		expect(normalizeThinkingLevel("unknown", "medium")).toBe("medium");
	});

	it("builds wizard summary with notices", () => {
		const config = createConfig({
			defaultProvider: "google",
			defaultModel: "gemini-3.1-flash-lite-preview",
			defaultThinkingLevel: "low",
			memory: { enabled: true },
			channels: {
				web: { enabled: true, settings: {} },
				telegram: { enabled: true, settings: { botToken: "token" } },
				slack: { enabled: false, settings: {} },
			},
		});
		const summary = buildWizardSummary("/tmp/understudy-config.json5", config, [
			"Telegram enabled without bot token in config/env.",
		]);

		expect(summary).toContain("Understudy setup completed.");
		expect(summary).toContain("Config saved: /tmp/understudy-config.json5");
		expect(summary).toContain("Default model: google/gemini-3.1-flash-lite-preview");
		expect(summary).toContain("Browser: mode=auto");
		expect(summary).toContain("Memory: enabled");
		expect(summary).toContain("Enabled channels: telegram, web");
		expect(summary).toContain("Notices:");
	});
});
