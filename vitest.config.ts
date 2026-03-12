import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "tests/**/*.test.ts"],
		testTimeout: 30000,
		coverage: {
			provider: "v8",
			// M1 core runtime paths: core + gateway + tools + web channel.
			include: [
				"packages/core/src/**/*.ts",
				"packages/gateway/src/**/*.ts",
				"packages/tools/src/**/*.ts",
				"packages/channels/src/**/*.ts",
			],
			exclude: [
				"**/*.test.ts",
				"**/*.d.ts",
				"**/index.ts",
				"**/node_modules/**",
				"apps/**",
				"packages/types/**",
				"packages/gateway/src/protocol.ts",
				"packages/channels/src/discord/**",
				"packages/channels/src/slack/**",
				"packages/channels/src/telegram/**",
				"packages/channels/src/whatsapp/**",
			],
			thresholds: {
				statements: 70,
				branches: 65,
				functions: 70,
				lines: 70,
			},
		},
	},
});
