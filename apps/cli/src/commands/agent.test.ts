import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	rpcCall: vi.fn(),
	resolveGatewayBrowserToken: vi.fn(),
}));

const ONE_PIXEL_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B9XYAAAAASUVORK5CYII=";
const tempDirs: string[] = [];

vi.mock("../rpc-client.js", () => ({
	createRpcClient: (_options: unknown) => ({
		call: mocks.rpcCall,
	}),
}));

vi.mock("./gateway-browser-auth.js", () => ({
	resolveGatewayBrowserToken: mocks.resolveGatewayBrowserToken,
}));

import { runAgentCommand } from "./agent.js";

describe("runAgentCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.resolveGatewayBrowserToken.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("surfaces gateway failures", async () => {
		mocks.rpcCall.mockRejectedValue(new Error("gateway unavailable"));
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await runAgentCommand({
			message: "hello",
			cwd: "/tmp/fallback-understudy",
		});

		expect(mocks.rpcCall).toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith("Error:", "gateway unavailable");
	});

	it("passes prompt images and gateway config overrides through the RPC payload", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "understudy-agent-"));
		tempDirs.push(tempDir);
		const imagePath = join(tempDir, "pixel.png");
		await writeFile(imagePath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));
		mocks.resolveGatewayBrowserToken.mockResolvedValue("secret-token");
		mocks.rpcCall.mockResolvedValue({
			response: "remote reply",
			status: "ok",
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runAgentCommand({
			message: "inspect this",
			cwd: tempDir,
			image: ["pixel.png"],
			model: "openai/gpt-4o-mini",
			thinking: "high",
			config: "/tmp/understudy.json5",
			host: "gateway.local",
		});

		expect(mocks.resolveGatewayBrowserToken).toHaveBeenCalledWith("/tmp/understudy.json5");
		expect(mocks.rpcCall).toHaveBeenNthCalledWith(
			1,
			"chat.send",
			{
				text: `<file name="${imagePath}"></file>\ninspect this`,
				cwd: tempDir,
				channelId: "cli",
				senderId: "understudy-cli",
				forceNew: true,
				waitForCompletion: false,
				configOverride: {
					defaultProvider: "openai",
					defaultModel: "gpt-4o-mini",
					defaultThinkingLevel: "high",
				},
				images: [
					{
						type: "image",
						data: ONE_PIXEL_PNG_BASE64,
						mimeType: "image/png",
					},
				],
			},
			expect.any(Object),
		);
		expect(log).toHaveBeenCalledWith("remote reply");
	});

	it("reuses the gateway session only when --continue is set", async () => {
		mocks.rpcCall.mockResolvedValueOnce({
			response: "",
			status: "in_flight",
			runId: "run-1",
			sessionId: "session-1",
		});
		mocks.rpcCall.mockResolvedValueOnce({
			status: "ok",
			response: "continued reply",
			runId: "run-1",
			sessionId: "session-1",
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runAgentCommand({
			message: "continue this",
			cwd: "/tmp/continue-understudy",
			continue: true,
		});

		expect(mocks.rpcCall).toHaveBeenNthCalledWith(
			1,
			"chat.send",
			expect.objectContaining({
				channelId: "cli",
				senderId: "understudy-cli",
				forceNew: false,
			}),
			expect.any(Object),
		);
		expect(log).toHaveBeenCalledWith("continued reply");
	});

	it("preserves returned images in json output", async () => {
		mocks.rpcCall.mockResolvedValueOnce({
			response: "",
			status: "in_flight",
			runId: "run-images",
			sessionId: "session-images",
		});
		mocks.rpcCall.mockResolvedValueOnce({
			status: "ok",
			response: "",
			runId: "run-images",
			sessionId: "session-images",
			images: [
				{
					type: "image",
					mimeType: "image/png",
					data: "c2NyZWVuc2hvdA==",
				},
			],
		});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runAgentCommand({
			message: "show me the screenshot",
			cwd: "/tmp/agent-images",
			json: true,
		});

		const payload = JSON.parse(String(log.mock.calls[0]?.[0] ?? "{}"));
		expect(payload.images).toEqual([
			{
				type: "image",
				mimeType: "image/png",
				data: "c2NyZWVuc2hvdA==",
			},
		]);
	});
});
