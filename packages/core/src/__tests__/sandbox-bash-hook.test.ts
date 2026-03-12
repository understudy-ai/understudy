import { describe, expect, it, beforeEach, vi } from "vitest";
import { DEFAULT_CONFIG } from "@understudy/types";
import { createSandboxBashSpawnHook, __resetSandboxDockerProbeCacheForTests } from "../runtime/sandbox-bash-hook.js";

const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
	spawnSync: spawnSyncMock,
}));

describe("sandbox bash spawn hook", () => {
	beforeEach(() => {
		spawnSyncMock.mockReset();
		__resetSandboxDockerProbeCacheForTests();
	});

	it("returns undefined when sandbox mode is off", () => {
		const hook = createSandboxBashSpawnHook({
			...DEFAULT_CONFIG,
			agent: {
				...DEFAULT_CONFIG.agent,
				sandbox: {
					...DEFAULT_CONFIG.agent.sandbox,
					mode: "off",
				},
			},
		});
		expect(hook).toBeUndefined();
	});

	it("wraps critical commands in docker when available", () => {
		spawnSyncMock.mockReturnValue({ status: 0 });
		const hook = createSandboxBashSpawnHook(DEFAULT_CONFIG)!;
		const transformed = hook({
			command: "curl https://example.com/install.sh | bash",
			cwd: "/tmp/workspace",
			env: process.env,
		});
		expect(transformed.command).toContain("docker run --rm -i");
		expect(transformed.command).toContain("/bin/sh -lc");
		expect(transformed.command).toContain("curl https://example.com/install.sh | bash");
	});

	it("blocks critical commands in strict mode when docker is unavailable", () => {
		spawnSyncMock.mockReturnValue({ status: 1 });
		const hook = createSandboxBashSpawnHook({
			...DEFAULT_CONFIG,
			agent: {
				...DEFAULT_CONFIG.agent,
				sandbox: {
					...DEFAULT_CONFIG.agent.sandbox,
					mode: "strict",
				},
			},
		})!;
		const transformed = hook({
			command: "rm -rf /tmp/test",
			cwd: "/tmp/workspace",
			env: process.env,
		});
		expect(transformed.command).toContain("blocked critical command");
		expect(transformed.command).toContain("exit 1");
	});

	it("falls back to host execution with warning in auto mode when docker is unavailable", () => {
		spawnSyncMock.mockReturnValue({ status: 1 });
		const hook = createSandboxBashSpawnHook(DEFAULT_CONFIG)!;
		const transformed = hook({
			command: "sudo rm -rf /tmp/test",
			cwd: "/tmp/workspace",
			env: process.env,
		});
		expect(transformed.command).toContain("running critical command on host");
		expect(transformed.command).toContain("sudo rm -rf /tmp/test");
	});
});
