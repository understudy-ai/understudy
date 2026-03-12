import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	rpcCall: vi.fn(),
}));

vi.mock("../rpc-client.js", () => ({
	createRpcClient: () => ({
		call: mocks.rpcCall,
	}),
}));

import { runAgentsCommand } from "./agents.js";

describe("runAgentsCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = 0;
	});

	it("lists configured agents", async () => {
		mocks.rpcCall.mockResolvedValue({
			defaultId: "main",
			scope: "per-sender",
			agents: [
				{ id: "main", name: "Main" },
				{ id: "ops", name: "Ops" },
			],
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runAgentsCommand({});

		const output = log.mock.calls.flat().join("\n");
		expect(output).toContain("Agents (2):");
		expect(output).toContain("main — Main [default]");
		expect(output).toContain("ops — Ops");
	});

	it("creates an agent with workspace/model metadata", async () => {
		mocks.rpcCall.mockResolvedValue({
			agentId: "ops",
			workspace: "/tmp/ops",
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runAgentsCommand({
			create: "Ops",
			workspace: "/tmp/ops",
			model: "openai/gpt-5",
			emoji: "robot",
			avatar: "🤖",
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("agents.create", {
			name: "Ops",
			workspace: "/tmp/ops",
			model: "openai/gpt-5",
			emoji: "robot",
			avatar: "🤖",
		});
		expect(log.mock.calls.flat().join("\n")).toContain("Agent created: ops");
		expect(log.mock.calls.flat().join("\n")).toContain("Workspace: /tmp/ops");
	});

	it("prints JSON for update mode without extra prose", async () => {
		mocks.rpcCall.mockResolvedValue({
			agentId: "ops",
			name: "Ops Prime",
			workspace: "/tmp/ops",
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runAgentsCommand({
			update: "ops",
			setName: "Ops Prime",
			workspace: "/tmp/ops",
			json: true,
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("agents.update", {
			agentId: "ops",
			name: "Ops Prime",
			workspace: "/tmp/ops",
			model: undefined,
			avatar: undefined,
		});
		expect(log).toHaveBeenCalledOnce();
		expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
			agentId: "ops",
			name: "Ops Prime",
		});
	});

	it("passes deleteFiles through and reports removed bindings", async () => {
		mocks.rpcCall.mockResolvedValue({
			removedBindings: 2,
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runAgentsCommand({
			delete: "ops",
			deleteFiles: true,
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("agents.delete", {
			agentId: "ops",
			deleteFiles: true,
		});
		expect(log.mock.calls.flat().join("\n")).toContain("Agent deleted: ops");
		expect(log.mock.calls.flat().join("\n")).toContain("Removed bindings: 2");
	});

	it("surfaces missing workspace validation for create", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await runAgentsCommand({
			create: "Ops",
		});

		expect(mocks.rpcCall).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith("Error:", "agents.create requires --workspace");
		expect(process.exitCode).toBe(1);
	});
});
