import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "@understudy/core";

const mocks = vi.hoisted(() => ({
	rpcCall: vi.fn(),
	createRpcClient: vi.fn(),
}));

vi.mock("../rpc-client.js", () => ({
	createRpcClient: mocks.createRpcClient.mockImplementation(() => ({
		call: mocks.rpcCall,
	})),
}));

vi.mock("@understudy/channels", async () => {
	const actual = await vi.importActual<any>("@understudy/channels");
	return {
		...actual,
		listChannelFactories: () => ["discord", "imessage", "line", "signal", "slack", "telegram", "web"],
	};
});

import { runChannelsCommand } from "./channels.js";

const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;
const tempDirs: string[] = [];

function createTempHome(): string {
	const dir = mkdtempSync(join(tmpdir(), "understudy-channels-test-"));
	tempDirs.push(dir);
	return dir;
}

async function readConfig(homeDir: string): Promise<Record<string, any>> {
	const path = join(homeDir, "config.json5");
	const manager = await ConfigManager.load(path);
	return manager.get() as unknown as Record<string, any>;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0, tempDirs.length)) {
		rmSync(dir, { recursive: true, force: true });
	}
	if (originalUnderstudyHome === undefined) {
		delete process.env.UNDERSTUDY_HOME;
	} else {
		process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
	}
	process.exitCode = 0;
});

describe("runChannelsCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = 0;
	});

	it("allows enabling unknown channel IDs", async () => {
		const homeDir = createTempHome();
		process.env.UNDERSTUDY_HOME = homeDir;

		await runChannelsCommand({ add: "custom-channel" });
		const config = await readConfig(homeDir);

		expect(config.channels["custom-channel"]).toMatchObject({ enabled: true });
		expect(process.exitCode ?? 0).toBe(0);
	});

	it("prints built-in setup hints when enabling a known channel", async () => {
		const homeDir = createTempHome();
		process.env.UNDERSTUDY_HOME = homeDir;
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runChannelsCommand({ add: "telegram" });
		const config = await readConfig(homeDir);
		const output = log.mock.calls.flat().join("\n");

		expect(config.channels.telegram).toMatchObject({ enabled: true });
		expect(output).toContain("Channel enabled: telegram");
		expect(output).toContain("TELEGRAM_BOT_TOKEN");
		expect(output).toContain("Built-in channel types:");
		expect(output).toContain("Restart gateway to apply channel changes.");
	});

	it("rejects invalid channel IDs", async () => {
		const homeDir = createTempHome();
		process.env.UNDERSTUDY_HOME = homeDir;

		await runChannelsCommand({ add: "invalid channel id" });
		const config = await readConfig(homeDir);

		expect(config.channels["invalid channel id"]).toBeUndefined();
		expect(process.exitCode).toBe(1);
	});

	it("lists channel runtime state and optional capabilities", async () => {
		mocks.rpcCall.mockResolvedValue([
			{
				id: "web",
				name: "Web Chat",
				runtime: { state: "active", summary: "Connected browser clients" },
				capabilities: { media: true, reactions: false, typing: true },
			},
		]);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runChannelsCommand({ capabilities: true, port: "4321" });

		expect(mocks.createRpcClient).toHaveBeenCalledWith({ port: 4321 });
		expect(mocks.rpcCall).toHaveBeenCalledWith("channel.list");
		expect(log.mock.calls.flat().join("\n")).toContain("web — Web Chat (active) [media, typing] — Connected browser clients");
	});

	it("prints status details for a specific channel", async () => {
		mocks.rpcCall.mockResolvedValue({
			id: "telegram",
			name: "Telegram",
			runtime: {
				state: "error",
				summary: "token missing",
				restartAttempt: 2,
				lastError: "401 unauthorized",
			},
			capabilities: { media: true },
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runChannelsCommand({ status: "telegram" });

		expect(mocks.rpcCall).toHaveBeenCalledWith("channel.status", { channelId: "telegram" });
		const output = log.mock.calls.flat().join("\n");
		expect(output).toContain("Channel: telegram");
		expect(output).toContain("State:        error");
		expect(output).toContain("Restart Try:  2");
		expect(output).toContain("Last Error:   401 unauthorized");
		expect(output).toContain("Capabilities: media");
		expect(output).toContain("Recovery: inspect credentials/runtime config");
		expect(output).toContain("Setup Hint: set channels.telegram.settings.botToken or TELEGRAM_BOT_TOKEN.");
	});

	it("disables a channel in config even when gateway logout fails", async () => {
		const homeDir = createTempHome();
		process.env.UNDERSTUDY_HOME = homeDir;
		await runChannelsCommand({ add: "slack" });
		mocks.rpcCall.mockRejectedValue(new Error("gateway offline"));
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runChannelsCommand({ remove: "slack" });
		const config = await readConfig(homeDir);

		expect(mocks.rpcCall).toHaveBeenCalledWith("channel.logout", { channelId: "slack" });
		expect(config.channels.slack).toMatchObject({ enabled: false });
		expect(log.mock.calls.flat().join("\n")).toContain("Channel disabled: slack");
	});
});
