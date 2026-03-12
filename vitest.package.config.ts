import { defineConfig } from "vitest/config";

export default defineConfig({
	root: process.cwd(),
	test: {
		include: ["src/**/*.test.ts"],
		testTimeout: 30000,
	},
});
