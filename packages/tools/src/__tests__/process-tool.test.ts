import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execSync: mocks.execSync,
}));

import { createProcessTool } from "../process-tool.js";
import {
	addExecSession,
	clearExecSessionsForTest,
	createExecSessionRecord,
} from "../exec-sessions.js";

describe("createProcessTool", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		clearExecSessionsForTest();
	});

	it("creates a tool with correct metadata", () => {
		const tool = createProcessTool();
		expect(tool.name).toBe("process");
		expect(tool.label).toBe("Process Manager");
	});

	it("lists processes via ps output", async () => {
		mocks.execSync.mockReturnValue(
			"PID USER %CPU %MEM COMMAND\n123 alice 12.0 1.0 node server.js\n456 bob 2.0 0.5 npm test\n",
		);
		const tool = createProcessTool();
		const result = await tool.execute("id", { action: "list" });
		const text = (result.content[0] as any).text;

		expect(mocks.execSync).toHaveBeenCalledWith("ps aux --sort=-%cpu 2>/dev/null || ps aux", {
			encoding: "utf-8",
			timeout: 5000,
		});
		expect(text).toContain("PID");
		expect(text).toContain("node server.js");
		expect(result.details).toEqual({ count: 2 });
	});

	it("returns an error when process listing fails", async () => {
		mocks.execSync.mockImplementation(() => {
			throw new Error("ps unavailable");
		});
		const tool = createProcessTool();
		const result = await tool.execute("id", { action: "list" });

		expect((result.content[0] as any).text).toContain("Error listing processes: ps unavailable");
		expect(result.details).toEqual({ error: true });
	});

	it("lists running exec sessions even before they are backgrounded", async () => {
		const session = createExecSessionRecord({
			command: "node server.js",
			cwd: "/tmp/workspace",
		});
		session.pid = 4321;
		session.tail = "still running";
		addExecSession(session);

		const tool = createProcessTool();
		const result = await tool.execute("id", { action: "list" });
		const text = (result.content[0] as any).text;

		expect(mocks.execSync).not.toHaveBeenCalled();
		expect(text).toContain(session.id);
		expect(text).toContain("running");
		expect(text).toContain("node server.js");
		expect(result.details).toMatchObject({
			status: "completed",
			sessions: [
				expect.objectContaining({
					sessionId: session.id,
					status: "running",
					pid: 4321,
					command: "node server.js",
				}),
			],
		});
	});

	it("returns error for unknown action", async () => {
		const tool = createProcessTool();
		const result = await tool.execute("id", { action: "unknown" });
		expect((result.content[0] as any).text).toContain("Unknown action");
	});

	it("returns error when pid missing for kill", async () => {
		const tool = createProcessTool();
		const result = await tool.execute("id", { action: "kill" });
		expect((result.content[0] as any).text).toContain("pid is required");
	});

	it("returns error when pid missing for info", async () => {
		const tool = createProcessTool();
		const result = await tool.execute("id", { action: "info" });
		expect((result.content[0] as any).text).toContain("pid is required");
	});

	it("gets deterministic process info from ps", async () => {
		mocks.execSync.mockReturnValue(
			"PID PPID USER %CPU %MEM STAT START COMMAND\n321 1 alice 0.1 0.2 S 09:00 node worker.js\n",
		);
		const tool = createProcessTool();
		const result = await tool.execute("id", { action: "info", pid: 321 });
		const text = (result.content[0] as any).text;

		expect(mocks.execSync).toHaveBeenCalledWith("ps -p 321 -o pid,ppid,user,%cpu,%mem,stat,start,command", {
			encoding: "utf-8",
			timeout: 5000,
		});
		expect(text).toContain("321");
		expect(text).toContain("node worker.js");
		expect(result.details).toEqual({ pid: 321 });
	});

	it("returns not found when ps lookup fails", async () => {
		mocks.execSync.mockImplementation(() => {
			throw new Error("ps failed");
		});
		const tool = createProcessTool();
		const result = await tool.execute("id", { action: "info", pid: 999999 });
		const text = (result.content[0] as any).text;

		expect(text).toContain("not found");
		expect(result.details).toEqual({ error: "not found", pid: 999999 });
	});

	it("forwards signals to process.kill and reports failures deterministically", async () => {
		const kill = vi.spyOn(process, "kill")
			.mockImplementationOnce(() => true as any)
			.mockImplementationOnce(() => {
				throw new Error("EPERM");
			});
		const tool = createProcessTool();

		const ok = await tool.execute("id", { action: "kill", pid: 42, signal: "SIGKILL" });
		const failed = await tool.execute("id", { action: "kill", pid: 99 });

		expect(kill).toHaveBeenNthCalledWith(1, 42, "SIGKILL");
		expect(kill).toHaveBeenNthCalledWith(2, 99, "SIGTERM");
		expect((ok.content[0] as any).text).toContain("Sent SIGKILL to process 42");
		expect(ok.details).toEqual({ pid: 42, signal: "SIGKILL" });
		expect((failed.content[0] as any).text).toContain("Error killing process 99: EPERM");
		expect(failed.details).toEqual({ error: true, pid: 99 });
	});
});
