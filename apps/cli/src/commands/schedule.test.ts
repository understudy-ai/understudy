import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	rpcCall: vi.fn(),
	createRpcClient: vi.fn(),
}));

vi.mock("../rpc-client.js", () => ({
	createRpcClient: mocks.createRpcClient.mockImplementation(() => ({
		call: mocks.rpcCall,
	})),
}));

import { runScheduleCommand } from "./schedule.js";

describe("runScheduleCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = 0;
	});

	it("maps add options to schedule.add", async () => {
		mocks.rpcCall.mockResolvedValue({ id: "job_1" });
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runScheduleCommand({
			add: true,
			name: "daily",
			schedule: "0 8 * * *",
			command: "echo hello",
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("schedule.add", {
			name: "daily",
			schedule: "0 8 * * *",
			command: "echo hello",
			enabled: true,
			delivery: undefined,
		});
		expect(log).toHaveBeenCalledWith("Schedule job added: job_1");
		log.mockRestore();
	});

	it("uses an extended default RPC timeout for schedule commands", async () => {
		mocks.rpcCall.mockResolvedValue([]);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runScheduleCommand({
			list: true,
		});

		expect(mocks.createRpcClient).toHaveBeenCalledWith({
			port: undefined,
			timeout: 600000,
		});
		log.mockRestore();
	});

		it("allows overriding the schedule RPC timeout", async () => {
			mocks.rpcCall.mockResolvedValue({ id: "job_2", ok: true });
			vi.spyOn(console, "log").mockImplementation(() => {});

		await runScheduleCommand({
			run: "job_2",
			timeout: "45000",
		} as any);

		expect(mocks.createRpcClient).toHaveBeenCalledWith({
			port: undefined,
			timeout: 45000,
		});
		expect(mocks.rpcCall).toHaveBeenCalledWith("schedule.run", { id: "job_2" });
	});

	it("maps update options including delivery target and disabled state", async () => {
		mocks.rpcCall.mockResolvedValue({ id: "job_3" });
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runScheduleCommand({
			update: "job_3",
			name: "weekday digest",
			schedule: "0 8 * * 1-5",
			command: "summarize inbox",
			disable: true,
			channelId: "telegram",
			senderId: "user-1",
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("schedule.update", {
			id: "job_3",
			name: "weekday digest",
			schedule: "0 8 * * 1-5",
			command: "summarize inbox",
			enabled: false,
			delivery: {
				channelId: "telegram",
				senderId: "user-1",
			},
		});
		expect(log).toHaveBeenCalledWith("Schedule job updated: job_3");
	});

	it("prints JSON for runs lookups and forwards the limit", async () => {
		mocks.rpcCall.mockResolvedValue({
			runs: [{ id: "run_1", status: "ok" }],
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runScheduleCommand({
			runs: "job_9",
			limit: "7",
			json: true,
		});

		expect(mocks.rpcCall).toHaveBeenCalledWith("schedule.runs", {
			id: "job_9",
			limit: 7,
		});
		expect(log).toHaveBeenCalledWith(JSON.stringify({
			runs: [{ id: "run_1", status: "ok" }],
		}, null, 2));
	});

	it("surfaces validation errors for missing add fields", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await runScheduleCommand({
			add: true,
			name: "broken-job",
		});

		expect(mocks.rpcCall).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith("Error:", "schedule.add requires --schedule and --command");
		expect(process.exitCode).toBe(1);
	});
});
