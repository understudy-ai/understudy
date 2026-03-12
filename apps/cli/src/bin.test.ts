import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

describe("cli bootstrap entry", () => {
	beforeEach(() => {
		vi.resetModules();
		process.env = { ...originalEnv };
		delete process.env.PI_CODING_AGENT_DIR;
		delete process.env.UNDERSTUDY_AGENT_DIR;
		delete process.env.UNDERSTUDY_HOME;
	});

	afterEach(() => {
		vi.resetModules();
		vi.doUnmock("./index.js");
		process.env = { ...originalEnv };
	});

	it("sets PI_CODING_AGENT_DIR from UNDERSTUDY_HOME before loading the main CLI entry", async () => {
		let observedAgentDir: string | undefined;

		vi.doMock("./index.js", () => {
			observedAgentDir = process.env.PI_CODING_AGENT_DIR;
			return {};
		});

		process.env.UNDERSTUDY_HOME = "/tmp/understudy-home";

		await import("./bin.js");

		expect(observedAgentDir).toBe("/tmp/understudy-home/agent");
		expect(process.env.PI_CODING_AGENT_DIR).toBe("/tmp/understudy-home/agent");
	});

	it("keeps an explicit PI_CODING_AGENT_DIR when one is already provided", async () => {
		let observedAgentDir: string | undefined;

		vi.doMock("./index.js", () => {
			observedAgentDir = process.env.PI_CODING_AGENT_DIR;
			return {};
		});

		process.env.PI_CODING_AGENT_DIR = "/tmp/custom-engine-agent";
		process.env.UNDERSTUDY_HOME = "/tmp/ignored-understudy-home";

		await import("./bin.js");

		expect(observedAgentDir).toBe("/tmp/custom-engine-agent");
		expect(process.env.PI_CODING_AGENT_DIR).toBe("/tmp/custom-engine-agent");
	});
});
