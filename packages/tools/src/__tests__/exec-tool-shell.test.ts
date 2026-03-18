import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearExecSessionsForTest } from "../exec-sessions.js";

const mocks = vi.hoisted(() => ({
	spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawn: mocks.spawn,
}));

function createMockChildProcess() {
	const child = new EventEmitter() as EventEmitter & {
		pid: number;
		stdin: { destroy: ReturnType<typeof vi.fn> };
		stdout: EventEmitter;
		stderr: EventEmitter;
		kill: ReturnType<typeof vi.fn>;
	};
	child.pid = 4321;
	child.stdin = {
		destroy: vi.fn(),
	};
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = vi.fn();
	queueMicrotask(() => {
		child.emit("close", 0, null);
	});
	return child;
}

describe("createExecTool shell invocation", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	afterEach(() => {
		clearExecSessionsForTest();
	});

	it("uses non-login shell execution to avoid sourcing profile files on every command", async () => {
		mocks.spawn.mockImplementation(() => createMockChildProcess() as any);
		const { createExecTool } = await import("../exec-tool.js");
		const tool = createExecTool();

		await tool.execute("id", {
			command: "echo ready",
			yieldMs: 1_000,
		});

		expect(mocks.spawn).toHaveBeenCalledWith(
			expect.any(String),
			["-c", "echo ready"],
			expect.objectContaining({
				stdio: ["pipe", "pipe", "pipe"],
			}),
		);
	});
});
