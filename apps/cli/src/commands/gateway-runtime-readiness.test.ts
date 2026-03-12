import { describe, expect, it } from "vitest";
import { collectGatewayRuntimeReadiness } from "./gateway-runtime-readiness.js";

describe("collectGatewayRuntimeReadiness", () => {
	it("aggregates browser, grounding, relay, and probe statuses", async () => {
		const snapshot = await collectGatewayRuntimeReadiness({
			config: {} as any,
			browserExtensionRelay: {
				baseUrl: "http://127.0.0.1:24444",
				cdpWsUrl: "ws://127.0.0.1:24444/devtools/browser/test",
				extensionConnected: () => false,
				stop: async () => {},
				host: "127.0.0.1",
				port: 24444,
			},
			deps: {
				platform: "darwin",
				now: () => 123,
				runBrowserPreflight: () => ({
					profile: "assistant",
					dependencies: {},
					toolAvailability: { browser: { enabled: true } },
					enabledToolNames: ["browser"],
					warnings: [],
					blockedInstallPackages: [],
				}),
				resolveGuiGrounding: async () => ({
					available: false,
					label: undefined,
					groundingProvider: undefined,
				}),
				inspectGuiReadiness: async () => ({
					status: "blocked",
					checkedAt: 222,
					checks: [
						{
							id: "accessibility",
							label: "Accessibility",
							status: "error",
							summary: "Accessibility permission is not granted for native GUI input.",
						},
						{
							id: "screen_recording",
							label: "Screen Recording",
							status: "ok",
							summary: "Screen Recording permission is granted for GUI screenshots.",
						},
					],
				}),
				inspectVideoTeachReadiness: async (_config) => ([
					{
						id: "video-teach-model",
						label: "Demo Teach Analyzer",
						status: "ok",
						summary: "Ready (doubao-seed-2-0-lite-260215)",
					},
					{
						id: "video-teach-ffmpeg",
						label: "Evidence Builder",
						status: "ok",
						summary: "ffmpeg available",
					},
					{
						id: "video-teach-recording",
						label: "Demo Recording",
						status: "ok",
						summary: "screencapture available",
					},
				]),
			},
		});

		expect(snapshot.generatedAt).toBe(123);
		expect(snapshot.status).toBe("error");
		expect(snapshot.checks.find((check) => check.id === "browser")).toMatchObject({
			status: "ok",
			summary: "Playwright available (managed mode)",
		});
		expect(snapshot.checks.find((check) => check.id === "grounding")).toMatchObject({
			status: "warn",
			summary: "No grounding provider configured",
		});
		expect(snapshot.checks.find((check) => check.id === "extension-relay")).toMatchObject({
			status: "warn",
			summary: "Ready, waiting for browser tab",
		});
		expect(snapshot.checks.find((check) => check.id === "accessibility")).toMatchObject({
			status: "error",
		});
		expect(snapshot.checks.find((check) => check.id === "screen_recording")).toMatchObject({
			status: "ok",
		});
		expect(snapshot.checks.find((check) => check.id === "video-teach-model")).toMatchObject({
			status: "ok",
			summary: "Ready (doubao-seed-2-0-lite-260215)",
		});
		expect(snapshot.checks.find((check) => check.id === "video-teach-recording")).toMatchObject({
			status: "ok",
			summary: "screencapture available",
		});
	});

	it("escalates to error when the browser mode is unavailable", async () => {
		const snapshot = await collectGatewayRuntimeReadiness({
			config: {} as any,
			deps: {
				platform: "darwin",
				runBrowserPreflight: () => ({
					profile: "assistant",
					dependencies: {},
					toolAvailability: { browser: { enabled: false, reason: "missing playwright" } },
					enabledToolNames: [],
					warnings: ["Tool browser disabled by preflight."],
					blockedInstallPackages: ["playwright"],
				}),
				resolveGuiGrounding: async () => ({
					available: true,
					label: "grounding-ok",
					groundingProvider: { ground: async () => undefined },
				}),
				inspectGuiReadiness: async () => ({
					status: "ready",
					checkedAt: 333,
					checks: [
						{
							id: "platform",
							label: "Platform",
							status: "ok",
							summary: "macOS GUI runtime is available on this host.",
						},
					],
				}),
				inspectVideoTeachReadiness: async (_config) => ([
					{
						id: "video-teach-model",
						label: "Demo Teach Analyzer",
						status: "warn",
						summary: "No Seed/ARK API key configured",
					},
					{
						id: "video-teach-recording",
						label: "Demo Recording",
						status: "warn",
						summary: "Direct demo recording requires macOS",
					},
				]),
			},
		});

		expect(snapshot.status).toBe("error");
		expect(snapshot.checks.find((check) => check.id === "browser")).toMatchObject({
			status: "error",
			detail: "missing playwright",
		});
	});

	it("escalates extension relay readiness to error when extension mode is the default route", async () => {
		const snapshot = await collectGatewayRuntimeReadiness({
			config: {} as any,
			browserExtensionRelay: {
				baseUrl: "http://127.0.0.1:24444",
				cdpWsUrl: "ws://127.0.0.1:24444/devtools/browser/test",
				extensionConnected: () => false,
				stop: async () => {},
				host: "127.0.0.1",
				port: 24444,
			},
			deps: {
				platform: "darwin",
				runBrowserPreflight: () => ({
					profile: "assistant",
					dependencies: {},
					toolAvailability: { browser: { enabled: true } },
					enabledToolNames: ["browser"],
					warnings: [],
					blockedInstallPackages: [],
				}),
				resolveBrowserConnectionMode: () => "extension",
				resolveBrowserCdpUrl: () => "http://127.0.0.1:24444",
				resolveGuiGrounding: async () => ({
					available: true,
					label: "grounding-ok",
					groundingProvider: { ground: async () => undefined },
				}),
				inspectGuiReadiness: async () => ({
					status: "ready",
					checkedAt: 333,
					checks: [
						{
							id: "platform",
							label: "Platform",
							status: "ok",
							summary: "macOS GUI runtime is available on this host.",
						},
					],
				}),
				inspectVideoTeachReadiness: async (_config) => [],
			},
		});

		expect(snapshot.status).toBe("error");
		expect(snapshot.checks.find((check) => check.id === "browser")).toMatchObject({
			status: "ok",
			summary: "Playwright available (extension mode)",
			detail: "Default browser mode uses extension relay via http://127.0.0.1:24444.",
		});
		expect(snapshot.checks.find((check) => check.id === "extension-relay")).toMatchObject({
			status: "error",
			summary: "Extension mode selected, but no browser tab is attached",
		});
	});

	it("treats auto mode as extension-first with managed fallback", async () => {
		const snapshot = await collectGatewayRuntimeReadiness({
			config: {
				browser: {
					connectionMode: "auto",
					cdpUrl: "http://127.0.0.1:24444",
				},
			} as any,
			deps: {
				platform: "darwin",
				runBrowserPreflight: () => ({
					profile: "assistant",
					dependencies: {},
					toolAvailability: { browser: { enabled: true } },
					enabledToolNames: ["browser"],
					warnings: [],
					blockedInstallPackages: [],
				}),
				resolveGuiGrounding: async () => ({
					available: true,
					label: "grounding-ok",
					groundingProvider: { ground: async () => undefined },
				}),
				inspectGuiReadiness: async () => ({
					status: "ready",
					checkedAt: 333,
					checks: [
						{
							id: "platform",
							label: "Platform",
							status: "ok",
							summary: "macOS GUI runtime is available on this host.",
						},
					],
				}),
				inspectVideoTeachReadiness: async (_config) => [],
			},
		});

		expect(snapshot.checks.find((check) => check.id === "browser")).toMatchObject({
			status: "ok",
			summary: "Playwright available (auto mode)",
			detail: "Default browser mode prefers extension relay via http://127.0.0.1:24444 and falls back to managed Playwright.",
		});
		expect(snapshot.checks.find((check) => check.id === "extension-relay")).toMatchObject({
			status: "warn",
			summary: "Extension relay not running; browser will fall back to managed",
		});
	});

	it("does not advertise GUI tools when helper readiness blocks the route", async () => {
		const snapshot = await collectGatewayRuntimeReadiness({
			config: {} as any,
			deps: {
				platform: "darwin",
				runBrowserPreflight: () => ({
					profile: "assistant",
					dependencies: {},
					toolAvailability: { browser: { enabled: true } },
					enabledToolNames: ["browser"],
					warnings: [],
					blockedInstallPackages: [],
				}),
				resolveGuiGrounding: async () => ({
					available: false,
					label: undefined,
					groundingProvider: undefined,
				}),
				inspectGuiReadiness: async () => ({
					status: "blocked",
					checkedAt: 444,
					checks: [
						{
							id: "platform",
							label: "Platform",
							status: "ok",
							summary: "macOS GUI runtime is available on this host.",
						},
						{
							id: "native_helper",
							label: "Native GUI Helper",
							status: "error",
							summary: "Native GUI helper is unavailable.",
						},
					],
				}),
				inspectVideoTeachReadiness: async () => [],
			},
		});

		expect(snapshot.checks.find((check) => check.id === "grounding")).toMatchObject({
			status: "warn",
			summary: "No grounding provider configured",
			detail: "GUI tools stay hidden until native helper and macOS permission blockers are resolved.",
		});
	});
});
