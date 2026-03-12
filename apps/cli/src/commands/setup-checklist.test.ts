import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectSetupChecklist, formatSetupChecklist } from "./setup-checklist.js";

const mocks = vi.hoisted(() => ({
	inspectProviderAuthStatuses: vi.fn(),
	runRuntimePreflight: vi.fn(),
	inspectGuiEnvironmentReadiness: vi.fn(),
	collectVideoTeachReadinessChecks: vi.fn(),
}));

vi.mock("@understudy/core", () => ({
	inspectProviderAuthStatuses: mocks.inspectProviderAuthStatuses,
	runRuntimePreflight: mocks.runRuntimePreflight,
}));

vi.mock("@understudy/gui", () => ({
	inspectGuiEnvironmentReadiness: mocks.inspectGuiEnvironmentReadiness,
}));

vi.mock("./gateway-runtime-readiness.js", () => ({
	collectVideoTeachReadinessChecks: mocks.collectVideoTeachReadinessChecks,
}));

describe("setup checklist", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
		mocks.inspectProviderAuthStatuses.mockReturnValue(new Map([
			["openai-codex", { available: true, source: "primary" }],
		]));
		mocks.runRuntimePreflight.mockReturnValue({
			dependencies: {
				playwright: { available: true },
			},
		});
		mocks.inspectGuiEnvironmentReadiness.mockResolvedValue({
			status: "ready",
			checkedAt: Date.now(),
			checks: [
				{ id: "accessibility", label: "Accessibility", status: "ok", summary: "Accessibility permission is granted for native GUI input." },
				{ id: "screen_recording", label: "Screen Recording", status: "error", summary: "Screen Recording permission is not granted for GUI screenshots." },
			],
		});
		mocks.collectVideoTeachReadinessChecks.mockResolvedValue([
			{ id: "video-teach-ffmpeg", label: "Evidence Builder", status: "ok", summary: "ffmpeg available" },
		]);
	});

	it("formats readiness and permission findings into a readable checklist", async () => {
		const checklist = await collectSetupChecklist({
			defaultProvider: "openai-codex",
			defaultModel: "gpt-5.4",
			channels: {},
			memory: { enabled: false },
			browser: { connectionMode: "managed", cdpUrl: "http://127.0.0.1:23336" },
			gateway: { port: 23333, host: "127.0.0.1", enableWebSocket: true, sessionScope: "channel_sender", dmScope: "sender", idleResetMinutes: 0, dailyReset: true, channelAutoRestart: true, channelRestartBaseDelayMs: 2000, channelRestartMaxDelayMs: 30000 },
			agent: {
				runtimeProfile: "assistant",
				runtimeBackend: "embedded",
				sandbox: { mode: "auto", dockerImage: "alpine:3.20", workspaceMountMode: "rw", disableNetwork: true },
				runtimePolicies: { enabled: true, modules: [] },
			},
			tools: { policies: [], autoApproveReadOnly: true },
			defaultThinkingLevel: "off",
		} as any);

		expect(checklist).toEqual(expect.arrayContaining([
			expect.objectContaining({
				id: "default-model-auth",
				status: "ok",
			}),
			expect.objectContaining({
				id: "gui-screen_recording",
				status: "error",
				openTarget: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
			}),
			expect.objectContaining({
				id: "teach-video-teach-ffmpeg",
				status: "ok",
			}),
		]));
		expect(formatSetupChecklist(checklist)).toContain("[ERR] Screen Recording");
	});

	it("reports the browser extension relay when extension mode is configured", async () => {
		const installDir = await mkdtemp(join(tmpdir(), "understudy-extension-check-"));
		await writeFile(join(installDir, "manifest.json"), "{}");
		process.env.UNDERSTUDY_GATEWAY_TOKEN = "gateway-token";

		try {
			const checklist = await collectSetupChecklist({
				defaultProvider: "openai-codex",
				defaultModel: "gpt-5.4",
				channels: {},
				memory: { enabled: false },
				browser: {
					connectionMode: "extension",
					cdpUrl: "http://127.0.0.1:23336",
					extension: { installDir },
				},
				gateway: {
					port: 23333,
					host: "127.0.0.1",
					enableWebSocket: true,
					sessionScope: "channel_sender",
					dmScope: "sender",
					idleResetMinutes: 0,
					dailyReset: true,
					channelAutoRestart: true,
					channelRestartBaseDelayMs: 2000,
					channelRestartMaxDelayMs: 30000,
				},
				agent: {
					runtimeProfile: "assistant",
					runtimeBackend: "embedded",
					sandbox: { mode: "auto", dockerImage: "alpine:3.20", workspaceMountMode: "rw", disableNetwork: true },
					runtimePolicies: { enabled: true, modules: [] },
				},
				tools: { policies: [], autoApproveReadOnly: true },
				defaultThinkingLevel: "off",
			} as any);

			expect(checklist).toEqual(expect.arrayContaining([
				expect.objectContaining({
					id: "browser-extension-route",
					status: "ok",
					openTarget: installDir,
				}),
			]));
		} finally {
			delete process.env.UNDERSTUDY_GATEWAY_TOKEN;
			await rm(installDir, { recursive: true, force: true });
		}
	});
});
