import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhysicalResourceLock } from "../physical-resource-lock.js";

const mocks = vi.hoisted(() => ({
	execFile: vi.fn(),
	mkdtemp: vi.fn(),
	readFile: vi.fn(),
	rm: vi.fn(),
	captureContextPayload: {
		appName: "Mail",
		display: {
			index: 1,
			bounds: { x: 0, y: 0, width: 800, height: 600 },
		},
		cursor: { x: 140, y: 220 },
		windowId: 73,
		windowTitle: "Composer",
		windowBounds: { x: 100, y: 200, width: 400, height: 300 },
		windowCount: 1,
		windowCaptureStrategy: "main_window",
	} as {
		appName: string;
		display: {
			index: number;
			bounds: { x: number; y: number; width: number; height: number };
		};
		cursor: { x: number; y: number };
		windowId: number;
		windowTitle: string;
		windowBounds: { x: number; y: number; width: number; height: number };
		windowCount: number;
		windowCaptureStrategy: string;
		hostSelfExcludeApplied?: boolean;
		hostFrontmostExcluded?: boolean;
		hostFrontmostAppName?: string;
		hostFrontmostBundleId?: string;
	},
	execCalls: [] as Array<{
		file: string;
		args: string[];
		env: Record<string, string | undefined>;
	}>,
	failAppleScriptType: false,
	clipboardText: "initial clipboard",
	redactionCount: 0,
}));

vi.mock("node:child_process", () => ({
	execFile: mocks.execFile,
}));

vi.mock("node:fs/promises", async () => {
	const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
	return {
		...actual,
		mkdtemp: mocks.mkdtemp,
		readFile: mocks.readFile,
		rm: mocks.rm,
	};
});

import { ComputerUseGuiRuntime } from "../runtime.js";

const MOCK_NATIVE_HELPER_PATH = "/tmp/mock-understudy-gui-native-helper";
const ONE_BY_ONE_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W2y0AAAAASUVORK5CYII=",
	"base64",
);

function createPngBuffer(width: number, height: number): Buffer {
	const bytes = Buffer.from(ONE_BY_ONE_PNG);
	bytes.writeUInt32BE(width, 16);
	bytes.writeUInt32BE(height, 20);
	return bytes;
}

function groundedTarget(
	target: string,
	point: { x: number; y: number },
	confidence = 0.92,
	options?: {
		coordinateSpace?: "image_pixels" | "display_pixels";
	},
) {
	const coordinateSpace = options?.coordinateSpace ?? "image_pixels";
	return {
		method: "grounding" as const,
		provider: "test-provider",
		confidence,
		reason: `Matched ${target}`,
		coordinateSpace,
		point,
		box: {
			x: point.x - 10,
			y: point.y - 8,
			width: 20,
			height: 16,
		},
	};
}

function createRuntime(
	ground: ReturnType<typeof vi.fn>,
	options?: {
		physicalResourceLock?: PhysicalResourceLock | null;
		platform?: NodeJS.Platform;
	},
) {
	return new ComputerUseGuiRuntime({
		groundingProvider: { ground },
		physicalResourceLock: options?.physicalResourceLock ?? null,
		platform: options?.platform,
	});
}

function actionKindForMode(mode: string | undefined): string {
	switch (mode) {
		case "click":
			return "cg_click";
		case "right_click":
			return "cg_right_click";
		case "double_click":
			return "cg_double_click";
		case "hover":
			return "cg_hover";
		case "move":
			return "cg_move";
		case "click_and_hold":
			return "cg_click_and_hold";
		case "drag":
			return "cg_drag";
		case "scroll":
			return "cg_scroll";
		case "type_text":
			return "cg_type_text";
		default:
			return "cg_event";
	}
}

function windowsActionKindForMode(mode: string | undefined): string {
	switch (mode) {
		case "click":
			return "powershell_click";
		case "right_click":
			return "powershell_right_click";
		case "double_click":
			return "powershell_double_click";
		case "hover":
			return "powershell_hover";
		case "click_and_hold":
			return "powershell_click_and_hold";
		case "drag":
			return "powershell_drag";
		case "scroll":
			return "powershell_scroll";
		case "move":
			return "powershell_move";
		case "cleanup":
			return "powershell_cleanup";
		default:
			return "powershell_gui_event";
	}
}

describe("ComputerUseGuiRuntime", () => {
	const originalPlatform = process.platform;
	const originalHostBundleId = process.env.__CFBundleIdentifier;
	const originalOriginator = process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
	const originalTermProgram = process.env.TERM_PROGRAM;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.execCalls.length = 0;
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
		process.env.UNDERSTUDY_GUI_NATIVE_HELPER_PATH = MOCK_NATIVE_HELPER_PATH;
		process.env.UNDERSTUDY_GUI_DISABLE_PHYSICAL_RESOURCE_LOCK = "1";
		process.env.UNDERSTUDY_GUI_DISABLE_EMERGENCY_STOP = "1";
		process.env.UNDERSTUDY_GUI_POST_ACTION_CAPTURE_SETTLE_MS = "0";
		process.env.__CFBundleIdentifier = "com.openai.codex";
		process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = "Codex Desktop";
		process.env.TERM_PROGRAM = "Codex";
		mocks.mkdtemp.mockResolvedValue("/tmp/understudy-gui-test");
		mocks.readFile.mockResolvedValue(createPngBuffer(800, 600));
		mocks.rm.mockResolvedValue(undefined);
		mocks.captureContextPayload = {
			appName: "Mail",
			display: {
				index: 1,
				bounds: { x: 0, y: 0, width: 800, height: 600 },
			},
			cursor: { x: 140, y: 220 },
			windowId: 73,
			windowTitle: "Composer",
			windowBounds: { x: 100, y: 200, width: 400, height: 300 },
			windowCount: 1,
			windowCaptureStrategy: "main_window",
		};
		mocks.failAppleScriptType = false;
		mocks.clipboardText = "initial clipboard";
		mocks.redactionCount = 0;
		mocks.execFile.mockImplementation((file: string, args: unknown, options: unknown, callback?: (...cbArgs: unknown[]) => void) => {
			const cb = (typeof options === "function" ? options : callback) as ((...cbArgs: unknown[]) => void) | undefined;
			if (!cb) {
				throw new Error("Missing execFile callback");
			}
			const resolvedArgs = Array.isArray(args) ? args.map((value) => String(value)) : [];
			const resolvedOptions = typeof options === "function" ? {} : (options ?? {});
			const env = typeof resolvedOptions === "object" && resolvedOptions !== null
				? { ...((resolvedOptions as Record<string, unknown>).env as Record<string, string | undefined> | undefined) }
				: {};
			mocks.execCalls.push({
				file,
				args: resolvedArgs,
				env,
			});

			if (file === "screencapture") {
				cb(null, { stdout: "", stderr: "" });
				return {} as any;
			}
			if (file === "sips") {
				cb(null, { stdout: "", stderr: "" });
				return {} as any;
			}
				if (
					file === "zsh" ||
					file === "/bin/zsh" ||
					file === "bash" ||
					file === "/bin/bash"
				) {
					const shellCommand = resolvedArgs.at(-1) ?? "";
					if (shellCommand === "printf 'secret-from-command\\n'") {
						cb(null, { stdout: "secret-from-command\n", stderr: "" });
						return {} as any;
				}
				cb(new Error(`Unexpected shell command: ${shellCommand}`));
				return {} as any;
			}
			if (file === "powershell.exe" || file === "pwsh.exe") {
				const commandText = resolvedArgs[resolvedArgs.length - 1] ?? "";
				if (commandText.includes("$PSVersionTable.PSVersion.ToString()")) {
					cb(null, { stdout: "5.1.22621.2506\n", stderr: "" });
					return {} as any;
				}
				if (
					commandText.includes("ConvertTo-Json") &&
					env.UNDERSTUDY_GUI_CAPTURE_WINDOW !== undefined
				) {
					cb(null, {
						stdout: JSON.stringify({
							appName: env.UNDERSTUDY_GUI_APP,
							display: {
								index: 1,
								bounds: { x: 0, y: 0, width: 1440, height: 900 },
							},
							cursor: { x: 320, y: 240 },
							...(env.UNDERSTUDY_GUI_CAPTURE_WINDOW === "1"
								? {
									windowTitle: env.UNDERSTUDY_GUI_WINDOW_TITLE ?? "Settings",
									windowBounds: { x: 100, y: 200, width: 480, height: 360 },
									windowCount: 1,
									windowCaptureStrategy: "main_window",
								}
								: {}),
						}),
						stderr: "",
					});
					return {} as any;
				}
				if (
					env.UNDERSTUDY_GUI_OUTPUT_PATH !== undefined &&
					env.UNDERSTUDY_GUI_CAPTURE_LEFT !== undefined
				) {
					cb(null, { stdout: "powershell_copyfromscreen\n", stderr: "" });
					return {} as any;
				}
				if (env.UNDERSTUDY_GUI_SENDKEYS_HOTKEY !== undefined) {
					cb(null, { stdout: "powershell_hotkey\n", stderr: "" });
					return {} as any;
				}
				if (env.UNDERSTUDY_GUI_TYPE_MODE !== undefined) {
					const baseAction = env.UNDERSTUDY_GUI_TYPE_MODE === "sendkeys"
						? "powershell_sendkeys"
						: "powershell_clipboard_paste";
					const stdout = env.UNDERSTUDY_GUI_SUBMIT === "1"
						? `${baseAction}+submit\n`
						: `${baseAction}\n`;
					cb(null, { stdout, stderr: "" });
					return {} as any;
				}
				if (env.UNDERSTUDY_GUI_EVENT_MODE !== undefined) {
					cb(null, {
						stdout: `${windowsActionKindForMode(env.UNDERSTUDY_GUI_EVENT_MODE)}\n`,
						stderr: "",
					});
					return {} as any;
				}
				cb(new Error(`Unexpected PowerShell command: ${commandText}`));
				return {} as any;
			}
			if (file === MOCK_NATIVE_HELPER_PATH) {
				if (resolvedArgs[0] === "capture-context") {
					cb(null, {
						stdout: JSON.stringify(mocks.captureContextPayload),
						stderr: "",
					});
					return {} as any;
				}
				if (resolvedArgs[0] === "event") {
					cb(null, {
						stdout: `${actionKindForMode(env.UNDERSTUDY_GUI_EVENT_MODE)}\n`,
						stderr: "",
					});
					return {} as any;
				}
					if (resolvedArgs[0] === "cleanup") {
						cb(null, {
							stdout: "cleanup\n",
							stderr: "",
						});
						return {} as any;
					}
					if (resolvedArgs[0] === "redact-host-windows") {
						cb(null, {
							stdout: JSON.stringify({ redactionCount: mocks.redactionCount }),
							stderr: "",
						});
						return {} as any;
					}
					if (resolvedArgs[0] === "activate") {
					cb(null, {
						stdout: "activated\n",
						stderr: "",
					});
					return {} as any;
				}
				return {} as any;
			}
			if (file === "osascript") {
				const scriptText = resolvedArgs[3] ?? "";
				if (typeof scriptText === "string" && scriptText.includes("return the clipboard as text")) {
					cb(null, {
						stdout: `${mocks.clipboardText}\n`,
						stderr: "",
					});
					return {} as any;
				}
				if (typeof scriptText === "string" && scriptText.includes("set the clipboard to restoredText")) {
					const argvIndex = resolvedArgs.indexOf("--");
					mocks.clipboardText = argvIndex >= 0 ? (resolvedArgs[argvIndex + 1] ?? "") : "";
					cb(null, {
						stdout: "clipboard_restored\n",
						stderr: "",
					});
					return {} as any;
				}
				const argvIndex = resolvedArgs.indexOf("--");
				const typedText = argvIndex >= 0 ? resolvedArgs[argvIndex + 1] : undefined;
				if ((typedText !== undefined || env.UNDERSTUDY_GUI_TEXT !== undefined) && mocks.failAppleScriptType) {
					const failure = Object.assign(new Error("osascript type failed"), {
						stderr: "osascript type failed",
					});
					cb(failure);
					return {} as any;
				}
				const stdout = typedText !== undefined || env.UNDERSTUDY_GUI_TEXT !== undefined
					? "typed\n"
					: env.UNDERSTUDY_GUI_KEY !== undefined || env.UNDERSTUDY_GUI_KEY_CODE !== undefined
						? "key_event\n"
						: "activated\n";
				cb(null, { stdout, stderr: "" });
				return {} as any;
			}
			cb(new Error(`Unexpected command: ${file}`));
			return {} as any;
		});
	});

	afterEach(() => {
		Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
		delete process.env.UNDERSTUDY_GUI_DISABLE_PHYSICAL_RESOURCE_LOCK;
		delete process.env.UNDERSTUDY_GUI_DISABLE_EMERGENCY_STOP;
		delete process.env.UNDERSTUDY_GUI_NATIVE_HELPER_PATH;
		delete process.env.UNDERSTUDY_GUI_POST_ACTION_CAPTURE_SETTLE_MS;
		delete process.env.UNDERSTUDY_TEST_GUI_SECRET;
		delete process.env.UNDERSTUDY_TEST_GUI_SECRET_COMMAND;
		if (originalHostBundleId === undefined) {
			delete process.env.__CFBundleIdentifier;
		} else {
			process.env.__CFBundleIdentifier = originalHostBundleId;
		}
		if (originalOriginator === undefined) {
			delete process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
		} else {
			process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = originalOriginator;
		}
		if (originalTermProgram === undefined) {
			delete process.env.TERM_PROGRAM;
		} else {
			process.env.TERM_PROGRAM = originalTermProgram;
		}
	});

	it("describes capabilities conservatively when Screen Recording is unavailable", () => {
		const runtime = new ComputerUseGuiRuntime({
			environmentReadiness: {
				status: "blocked",
				checkedAt: 1,
				checks: [
					{ id: "platform", label: "Platform", status: "ok", summary: "macOS GUI runtime is available on this host." },
					{ id: "accessibility", label: "Accessibility", status: "ok", summary: "Accessibility permission is granted for native GUI input." },
					{ id: "screen_recording", label: "Screen Recording", status: "error", summary: "Screen Recording permission is not granted for GUI screenshots." },
					{ id: "native_helper", label: "Native GUI Helper", status: "ok", summary: "Native GUI helper is ready for capture and input execution." },
				],
			},
		});

		const capabilities = runtime.describeCapabilities("darwin");

		expect(capabilities).toMatchObject({
			platformSupported: true,
			groundingAvailable: false,
			nativeHelperAvailable: true,
			screenCaptureAvailable: false,
			inputAvailable: true,
		});
		expect(capabilities.toolAvailability.gui_observe).toMatchObject({
			enabled: false,
		});
		expect(capabilities.toolAvailability.gui_scroll).toMatchObject({
			enabled: true,
			targetlessOnly: true,
		});
		expect(capabilities.toolAvailability.gui_key).toMatchObject({
			enabled: true,
		});
	});

	it("describes capabilities conservatively when Accessibility is unavailable", () => {
		const runtime = new ComputerUseGuiRuntime({
			environmentReadiness: {
				status: "blocked",
				checkedAt: 1,
				checks: [
					{ id: "platform", label: "Platform", status: "ok", summary: "macOS GUI runtime is available on this host." },
					{ id: "accessibility", label: "Accessibility", status: "error", summary: "Accessibility permission is not granted for native GUI input." },
					{ id: "screen_recording", label: "Screen Recording", status: "ok", summary: "Screen Recording permission is granted for GUI screenshots." },
					{ id: "native_helper", label: "Native GUI Helper", status: "ok", summary: "Native GUI helper is ready for capture and input execution." },
				],
			},
		});

		const capabilities = runtime.describeCapabilities("darwin");

		expect(capabilities).toMatchObject({
			platformSupported: true,
			groundingAvailable: false,
			nativeHelperAvailable: true,
			screenCaptureAvailable: true,
			inputAvailable: false,
		});
		expect(capabilities.toolAvailability.gui_observe).toMatchObject({
			enabled: true,
			targetlessOnly: true,
		});
		expect(capabilities.toolAvailability.gui_key).toMatchObject({
			enabled: false,
		});
		expect(capabilities.toolAvailability.gui_click).toMatchObject({
			enabled: false,
		});
	});

	it("keeps gui_move available without grounding when input is available", () => {
		const runtime = new ComputerUseGuiRuntime({
			environmentReadiness: {
				status: "ready",
				checkedAt: 1,
				checks: [
					{ id: "platform", label: "Platform", status: "ok", summary: "macOS GUI runtime is available on this host." },
					{ id: "accessibility", label: "Accessibility", status: "ok", summary: "Accessibility permission is granted for native GUI input." },
					{ id: "screen_recording", label: "Screen Recording", status: "ok", summary: "Screen Recording permission is granted for GUI screenshots." },
					{ id: "native_helper", label: "Native GUI Helper", status: "ok", summary: "Native GUI helper is ready for capture and input execution." },
				],
			},
		});

		const capabilities = runtime.describeCapabilities("darwin");

		expect(capabilities.groundingAvailable).toBe(false);
		expect(capabilities.toolAvailability.gui_move).toMatchObject({
			enabled: true,
		});
	});

	it("uses the injected platform for capability checks and unsupported actions", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
		});

		expect(runtime.describeCapabilities()).toMatchObject({
			platformSupported: true,
		});
		expect(runtime.describeCapabilities().toolAvailability).toMatchObject({
			gui_observe: { enabled: true },
			gui_wait: { enabled: false },
			gui_key: { enabled: true },
			gui_type: {
				enabled: true,
				targetlessOnly: true,
			},
			gui_scroll: {
				enabled: true,
				targetlessOnly: true,
			},
			gui_move: { enabled: true },
			gui_click: { enabled: false },
		});

		const result = await runtime.click({
			target: "Send button",
		});

		expect(result.status.code).toBe("unsupported");
		expect(result.status.summary).toContain("Visual grounding is not configured");
		expect(mocks.execCalls).toEqual([]);
	});

	it("captures Windows gui_observe screenshots through PowerShell", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
		});

		const result = await runtime.observe();

		expect(result.status).toEqual({
			code: "observed",
			summary: "Visual GUI snapshot captured.",
		});
		expect(result.details).toMatchObject({
			capture_method: "powershell_copyfromscreen",
			capture_mode: "display",
			capture_cursor_visible: false,
			grounding_method: "screenshot",
		});
		expect(result.observation?.platform).toBe("win32");
		const powerShellCall = mocks.execCalls.find((call) =>
			call.file === "powershell.exe" &&
			call.env.UNDERSTUDY_GUI_OUTPUT_PATH !== undefined,
		);
		expect(powerShellCall?.env.UNDERSTUDY_GUI_OUTPUT_PATH).toContain("gui-screenshot.png");
	});

	it("captures window-scoped gui_observe screenshots on Windows", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
		});

		const result = await runtime.observe({
			captureMode: "window",
			windowTitle: "Settings",
		});

		expect(result.status).toEqual({
			code: "observed",
			summary: "Visual GUI snapshot captured.",
		});
		expect(result.details).toMatchObject({
			capture_method: "powershell_copyfromscreen",
			capture_mode: "window",
			window_title: "Settings",
		});
	});

	it("rejects window index selection for gui_observe on Windows", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
		});

		const result = await runtime.observe({
			windowSelector: {
				titleContains: "Settings",
				index: 2,
			},
		});

		expect(result.status).toEqual({
			code: "unsupported",
			summary: "Windows GUI observation does not support window index selection yet. Omit `windowSelector.index`.",
		});
		expect(mocks.execCalls).toEqual([]);
	});

	it("uses the Windows backend for targetless gui_type", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
		});

		const result = await runtime.type({
			value: "hello from windows",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "powershell_clipboard_paste",
			grounding_method: "targetless",
		});
		const powerShellCall = mocks.execCalls.find((call) =>
			call.file === "powershell.exe" &&
			call.env.UNDERSTUDY_GUI_TYPE_MODE === "clipboard",
		);
		expect(powerShellCall?.env).toMatchObject({
			UNDERSTUDY_GUI_TEXT: "hello from windows",
			UNDERSTUDY_GUI_REPLACE: "1",
			UNDERSTUDY_GUI_SUBMIT: "0",
		});
	});

	it("uses the Windows backend for gui_key", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
		});

		const result = await runtime.key({
			key: "enter",
			modifiers: ["ctrl"],
			repeat: 2,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "powershell_hotkey",
			repeat: 2,
			grounding_method: "targetless",
		});
		const powerShellCall = mocks.execCalls.find((call) =>
			call.file === "powershell.exe" &&
			call.env.UNDERSTUDY_GUI_SENDKEYS_HOTKEY !== undefined,
		);
		expect(powerShellCall?.env).toMatchObject({
			UNDERSTUDY_GUI_SENDKEYS_HOTKEY: "^{ENTER}",
			UNDERSTUDY_GUI_REPEAT: "2",
		});
	});

	it("uses the Windows backend for grounded gui_click when grounding is available", async () => {
		const runtime = createRuntime(
			vi.fn().mockResolvedValueOnce(groundedTarget("Send button", { x: 48, y: 64 }, 0.93)),
			{ platform: "win32" },
		);

		const result = await runtime.click({
			app: "Mail",
			target: "Send button",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "powershell_click",
			grounding_provider: "test-provider",
			capture_method: "powershell_copyfromscreen",
		});
		const powerShellEventCall = mocks.execCalls.find((call) =>
			call.file === "powershell.exe" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "click",
		);
		expect(powerShellEventCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "Mail",
			UNDERSTUDY_GUI_X: "128.8",
			UNDERSTUDY_GUI_Y: "238.4",
		});
	});

	it("uses the Windows backend for targeted gui_type when grounding is available", async () => {
		const runtime = createRuntime(
			vi.fn().mockResolvedValueOnce(groundedTarget("Search box", { x: 60, y: 80 }, 0.92)),
			{ platform: "win32" },
		);

		const result = await runtime.type({
			app: "Mail",
			target: "Search box",
			value: "hello",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "powershell_clipboard_paste",
			grounding_provider: "test-provider",
		});
		expect(mocks.execCalls.some((call) =>
			call.file === "powershell.exe" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "click",
		)).toBe(true);
		expect(mocks.execCalls.some((call) =>
			call.file === "powershell.exe" &&
			call.env.UNDERSTUDY_GUI_TYPE_MODE === "clipboard" &&
			call.env.UNDERSTUDY_GUI_TEXT === "hello",
		)).toBe(true);
	});

	it("uses the Windows backend for targetless gui_scroll", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
		});

		const result = await runtime.scroll({
			app: "Mail",
			direction: "down",
			distance: "page",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "powershell_scroll",
			grounding_method: "targetless",
		});
		const powerShellCall = mocks.execCalls.find((call) =>
			call.file === "powershell.exe" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "scroll",
		);
		expect(powerShellCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "Mail",
			UNDERSTUDY_GUI_ACTIVATE_APP: "1",
		});
	});

	it("uses the Windows backend for gui_move", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
		});

		const result = await runtime.move({
			app: "Mail",
			x: 200,
			y: 180,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "powershell_move",
			executed_point: { x: 200, y: 180 },
		});
		const powerShellCall = mocks.execCalls.find((call) =>
			call.file === "powershell.exe" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "move",
		);
		expect(powerShellCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "Mail",
			UNDERSTUDY_GUI_X: "200",
			UNDERSTUDY_GUI_Y: "180",
		});
	});

	it("uses the native helper for gui_move on macOS", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.move({
			app: "Mail",
			x: 200,
			y: 180,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_move",
			executed_point: { x: 200, y: 180 },
			app: "Mail",
		});
		const nativeHelperCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "move",
		);
		expect(nativeHelperCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "Mail",
			UNDERSTUDY_GUI_ACTIVATE_APP: "1",
			UNDERSTUDY_GUI_X: "200",
			UNDERSTUDY_GUI_Y: "180",
		});
	});

	it("captures screenshots with the cursor visible", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe();

		expect(result.status).toEqual({
			code: "observed",
			summary: "Visual GUI snapshot captured.",
		});
		expect(result.details).toMatchObject({
			capture_method: "screencapture",
			capture_cursor_visible: true,
			grounding_method: "screenshot",
			confidence: 1,
		});
		expect(result.image).toMatchObject({
			mimeType: "image/png",
			filename: "gui-screenshot.png",
		});
		expect(mocks.execCalls.find((call) => call.file === "screencapture")?.args).toEqual([
			"-x",
			"-C",
			"-D1",
			"-t",
			"png",
			"/tmp/understudy-gui-test/gui-screenshot.png",
		]);
	});

	it("prefers a region capture for app-scoped screenshots", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe({
			app: "Mail",
		});

		expect(result.details).toMatchObject({
			capture_mode: "window",
			window_title: "Composer",
			window_count: 1,
			window_capture_strategy: "main_window",
		});
		expect(mocks.execCalls.find((call) => call.file === "screencapture")?.args).toEqual([
			"-x",
			"-C",
			"-R",
			"100,200,400,300",
			"-t",
			"png",
			"/tmp/understudy-gui-test/gui-screenshot.png",
		]);
		expect(mocks.execCalls.find((call) => call.file === "sips")).toBeUndefined();
	});

	it("captures the minimal union of visible app windows", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			windowBounds: { x: 60, y: 180, width: 560, height: 320 },
			windowCount: 2,
			windowCaptureStrategy: "app_union",
		};
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe({
			app: "Mail",
		});

		expect(result.details).toMatchObject({
			capture_mode: "window",
			capture_rect: { x: 60, y: 180, width: 560, height: 320 },
			window_count: 2,
			window_capture_strategy: "app_union",
		});
		expect(mocks.execCalls.find((call) => call.file === "screencapture")?.args).toEqual([
			"-x",
			"-C",
			"-R",
			"60,180,560,320",
			"-t",
			"png",
			"/tmp/understudy-gui-test/gui-screenshot.png",
		]);
		expect(mocks.execCalls.find((call) => call.file === "sips")).toBeUndefined();
	});

	it("tracks retina-scaled app regions without extra canvas cropping", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			windowBounds: { x: 50, y: 120, width: 500, height: 320 },
			windowCount: 2,
			windowCaptureStrategy: "app_union",
		};
		mocks.readFile.mockResolvedValueOnce(createPngBuffer(1000, 640));
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe({
			app: "Mail",
		});

		expect(result.details).toMatchObject({
			capture_mode: "window",
			capture_image_size: {
				width: 1000,
				height: 640,
			},
			capture_scale_x: 2,
			capture_scale_y: 2,
			window_capture_strategy: "app_union",
		});
		expect(mocks.execCalls.find((call) => call.file === "sips")).toBeUndefined();
	});

	it("uses explicit display capture when requested", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe({
			app: "Mail",
			captureMode: "display",
		});

		expect(result.details).toMatchObject({
			capture_mode: "display",
		});
		expect(mocks.execCalls.find((call) => call.file === "screencapture")?.args).toEqual([
			"-x",
			"-C",
			"-D1",
			"-t",
			"png",
			"/tmp/understudy-gui-test/gui-screenshot.png",
		]);
	});

	it("cleans up the screenshot temp directory when capture fails", async () => {
		const runtime = new ComputerUseGuiRuntime();
		const originalImpl = mocks.execFile.getMockImplementation();
		if (!originalImpl) {
			throw new Error("Expected execFile mock implementation");
		}
		mocks.execFile.mockImplementation((
			file: string,
			args: unknown,
			options: unknown,
			callback?: (...cbArgs: unknown[]) => void,
		) => {
			const cb = (typeof options === "function" ? options : callback) as ((...cbArgs: unknown[]) => void) | undefined;
			if (!cb) {
				throw new Error("Missing execFile callback");
			}
			if (file === "screencapture") {
				cb(Object.assign(new Error("capture blocked"), {
					stderr: "screen capture denied",
				}));
				return {} as any;
			}
			return originalImpl(file, args, options, callback);
		});

		await expect(runtime.observe()).rejects.toThrow("macOS screenshot capture failed");
		expect(mocks.rm).toHaveBeenCalledWith("/tmp/understudy-gui-test", {
			recursive: true,
			force: true,
		});
	});

	it("passes window selection through to the capture helper", async () => {
		const runtime = new ComputerUseGuiRuntime();

		await runtime.observe({
			app: "Mail",
			windowTitle: "Inbox",
			windowSelector: {
				titleContains: "Inbox",
				index: 2,
			},
		});

		const captureCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "capture-context",
		);
		expect(captureCall?.env).toMatchObject({
			UNDERSTUDY_GUI_WINDOW_TITLE: "Inbox",
			UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS: "Inbox",
			UNDERSTUDY_GUI_WINDOW_INDEX: "2",
		});
	});

	it("passes host self-exclude hints to the capture helper by default", async () => {
		const runtime = new ComputerUseGuiRuntime();

		await runtime.observe();

		const captureCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "capture-context",
		);
		expect(captureCall?.env).toMatchObject({
			UNDERSTUDY_GUI_AUTO_EXCLUDED_BUNDLE_IDS: "com.openai.codex",
			UNDERSTUDY_GUI_AUTO_EXCLUDED_OWNER_NAMES: expect.stringContaining("Codex"),
		});
		expect(captureCall?.env.UNDERSTUDY_GUI_AUTO_EXCLUDED_OWNER_NAMES).toContain("Codex Desktop");
	});

	it("skips host self-exclude when the requested app is the host app", async () => {
		const runtime = new ComputerUseGuiRuntime();

		await runtime.observe({
			app: "Codex Desktop",
		});

		const captureCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "capture-context",
		);
		expect(captureCall?.env.UNDERSTUDY_GUI_AUTO_EXCLUDED_BUNDLE_IDS).toBeUndefined();
		expect(captureCall?.env.UNDERSTUDY_GUI_AUTO_EXCLUDED_OWNER_NAMES).toBeUndefined();
	});

	it("uses the helper-resolved app for targetless gui_type when host self-exclude redirected capture context", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			appName: "Safari",
			hostSelfExcludeApplied: true,
			hostFrontmostExcluded: true,
			hostFrontmostAppName: "Codex Desktop",
			hostFrontmostBundleId: "com.openai.codex",
		};
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			value: "hello",
			typeStrategy: "clipboard_paste",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_type_text",
			app: "Safari",
			grounding_method: "targetless",
		});
		const nativeTypeCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "type_text",
		);
		expect(nativeTypeCall?.env.UNDERSTUDY_GUI_APP).toBe("Safari");
	});

	it("uses the helper-resolved app for targetless gui_key when host self-exclude redirected capture context", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			appName: "Safari",
			hostSelfExcludeApplied: true,
			hostFrontmostExcluded: true,
			hostFrontmostAppName: "Codex Desktop",
			hostFrontmostBundleId: "com.openai.codex",
		};
		const runtime = createRuntime(vi.fn());

		const result = await runtime.key({
			key: "enter",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "key_event",
			app: "Safari",
			grounding_method: "targetless",
		});
		const keyCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.env.UNDERSTUDY_GUI_KEY_CODE === "36",
		);
		expect(keyCall?.env.UNDERSTUDY_GUI_APP).toBe("Safari");
	});

	it("uses the helper-resolved app for targetless gui_scroll when host self-exclude redirected capture context", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			appName: "Safari",
			hostSelfExcludeApplied: true,
			hostFrontmostExcluded: true,
			hostFrontmostAppName: "Codex Desktop",
			hostFrontmostBundleId: "com.openai.codex",
		};
		const runtime = createRuntime(vi.fn());

		const result = await runtime.scroll({
			direction: "down",
			distance: "page",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_scroll",
			app: "Safari",
			grounding_method: "targetless",
		});
		const scrollCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "scroll",
		);
		expect(scrollCall?.env.UNDERSTUDY_GUI_APP).toBe("Safari");
	});

	it("downgrades implicit display capture when the host app is frontmost", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			hostSelfExcludeApplied: true,
			hostFrontmostExcluded: true,
			hostFrontmostAppName: "Codex Desktop",
			hostFrontmostBundleId: "com.openai.codex",
		};
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe();

		expect(result.details).toMatchObject({
			capture_mode: "window",
			capture_host_self_exclude_applied: true,
			capture_host_frontmost_excluded: true,
			capture_host_self_exclude_adjusted: true,
			capture_host_frontmost_app: "Codex Desktop",
		});
		expect(mocks.execCalls.find((call) => call.file === "screencapture")?.args).toEqual([
			"-x",
			"-C",
			"-R",
			"100,200,400,300",
			"-t",
			"png",
			"/tmp/understudy-gui-test/gui-screenshot.png",
		]);
		expect(mocks.execCalls.some((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH && call.args[0] === "redact-host-windows",
		)).toBe(false);
	});

	it("skips redaction from display capture when host self-exclude applied but host is not frontmost", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			hostSelfExcludeApplied: true,
			hostFrontmostExcluded: false,
			hostFrontmostAppName: "Safari",
			hostFrontmostBundleId: "com.apple.Safari",
		};
		mocks.redactionCount = 0;
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe({
			captureMode: "display",
		});

		expect(result.details).toMatchObject({
			capture_mode: "display",
			capture_host_self_exclude_applied: true,
			capture_host_frontmost_excluded: false,
		});
		expect(result.details?.capture_host_self_exclude_redaction_count).toBe(0);
		expect(mocks.execCalls.some((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH && call.args[0] === "redact-host-windows",
		)).toBe(false);
	});

	it("redacts host windows from explicit display capture when the host app is frontmost", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			hostSelfExcludeApplied: true,
			hostFrontmostExcluded: true,
			hostFrontmostAppName: "Codex Desktop",
			hostFrontmostBundleId: "com.openai.codex",
		};
		mocks.redactionCount = 2;
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe({
			captureMode: "display",
		});

		expect(result.details).toMatchObject({
			capture_mode: "display",
			capture_host_self_exclude_applied: true,
			capture_host_frontmost_excluded: true,
			capture_host_self_exclude_redaction_count: 2,
		});
		expect(mocks.execCalls.find((call) => call.file === "screencapture")?.args).toEqual([
			"-x",
			"-C",
			"-D1",
			"-t",
			"png",
			"/tmp/understudy-gui-test/gui-screenshot.png",
		]);
		expect(mocks.execCalls.some((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH && call.args[0] === "redact-host-windows",
		)).toBe(true);
	});

	it("resolves GUI observe targets visually", async () => {
		const ground = vi.fn().mockResolvedValue(
			groundedTarget("Send button", { x: 48, y: 64 }),
		);
		const runtime = createRuntime(ground);

		const result = await runtime.observe({
			target: "Send button",
			scope: "composer",
		});

		expect(result.status).toEqual({
			code: "resolved",
			summary: "Resolved a GUI target from the screenshot grounding route.",
		});
		expect(result.text).toContain('Resolved "Send button" visually.');
		expect(result.details).toMatchObject({
			grounding_provider: "test-provider",
			confidence: 0.92,
			capture_mode: "window",
			capture_cursor_visible: false,
			window_title: "Composer",
		});
		expect(ground).toHaveBeenCalledWith(expect.objectContaining({
			target: "Send button",
			scope: "composer",
		}));
		expect(mocks.execCalls.find((call) => call.file === "screencapture")?.args).not.toContain("-C");
	});

	it("omits the screenshot image when gui_observe returnImage is false", async () => {
		const runtime = new ComputerUseGuiRuntime();

		const result = await runtime.observe({
			app: "Mail",
			returnImage: false,
		});

		expect(result.status.code).toBe("observed");
		expect(result.image).toBeUndefined();
	});

		it("re-grounds a same-target click after gui_observe so action-specific context reaches the grounding model", async () => {
		const ground = vi.fn().mockResolvedValue(
			groundedTarget("Send button", { x: 48, y: 64 }, 0.96),
		);
		const runtime = createRuntime(ground);

		const readResult = await runtime.observe({
			target: "Send button",
			scope: "composer",
		});
		const clickResult = await runtime.click({
			target: "Send button",
			scope: "composer",
		});

		expect(readResult.status.code).toBe("resolved");
		expect(clickResult.status.code).toBe("action_sent");
		expect(ground).toHaveBeenCalledTimes(2);
		expect(ground.mock.calls[0]?.[0]).toMatchObject({
			action: "observe",
		});
		expect(ground.mock.calls[1]?.[0]).toMatchObject({
			action: "click",
		});
			const clickCall = mocks.execCalls.find((call) =>
				call.file === MOCK_NATIVE_HELPER_PATH &&
				call.args[0] === "event" &&
				call.env.UNDERSTUDY_GUI_EVENT_MODE === "click",
			);
			expect(clickCall?.env.UNDERSTUDY_GUI_X).toBe("124");
				expect(clickCall?.env.UNDERSTUDY_GUI_Y).toBe("232");
		});

		it("passes location hints into grounding requests", async () => {
			const ground = vi.fn().mockResolvedValue(
				groundedTarget("Save button", { x: 72, y: 88 }, 0.95),
			);
			const runtime = createRuntime(ground);

			await runtime.click({
				target: "Save button",
				locationHint: "bottom-right dialog footer",
				scope: "Export dialog",
			});

			expect(ground).toHaveBeenCalledWith(expect.objectContaining({
				target: "Save button",
				locationHint: "bottom-right dialog footer",
				scope: "Export dialog",
			}));
		});

	it("converts image-space grounding points into display-space click coordinates", async () => {
		const ground = vi.fn().mockResolvedValue({
			method: "grounding" as const,
			provider: "test-provider",
			confidence: 0.97,
			reason: "Matched Send button",
			coordinateSpace: "image_pixels" as const,
			point: { x: 200, y: 100 },
			box: { x: 160, y: 60, width: 80, height: 40 },
		});
		const runtime = createRuntime(ground);

		const result = await runtime.click({
			target: "Send button",
		});

		const clickCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "click",
		);
		expect(clickCall?.env.UNDERSTUDY_GUI_X).toBe("200");
		expect(clickCall?.env.UNDERSTUDY_GUI_Y).toBe("250");
		expect(result.details).toMatchObject({
			grounding_coordinate_space: "image_pixels",
			grounding_image_point: { x: 200, y: 100 },
			grounding_display_point: { x: 200, y: 250 },
			grounding_display_box: { x: 180, y: 230, width: 40, height: 20 },
			executed_point: { x: 200, y: 250 },
			capture_mode: "window",
			pre_action_capture: {
				capture_mode: "window",
				window_title: "Composer",
			},
		});
		expect(result.image?.mimeType).toBe("image/png");
	});

	it("accepts display-space grounding points from custom providers without reprojecting them", async () => {
		const ground = vi.fn().mockResolvedValue(
			groundedTarget(
				"Send button",
				{ x: 240, y: 280 },
				0.97,
				{ coordinateSpace: "display_pixels" },
			),
		);
		const runtime = createRuntime(ground);

		const result = await runtime.click({
			target: "Send button",
		});

		const clickCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "click",
		);
		expect(clickCall?.env.UNDERSTUDY_GUI_X).toBe("240");
		expect(clickCall?.env.UNDERSTUDY_GUI_Y).toBe("280");
		expect(result.details).toMatchObject({
			grounding_coordinate_space: "display_pixels",
			grounding_display_point: { x: 240, y: 280 },
			grounding_display_box: { x: 230, y: 272, width: 20, height: 16 },
			grounding_image_point: undefined,
			grounding_image_box: undefined,
			executed_point: { x: 240, y: 280 },
		});
	});

	it("converts image-space grounding points against a multi-window union capture", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			windowBounds: { x: 50, y: 120, width: 500, height: 320 },
			windowCount: 2,
			windowCaptureStrategy: "app_union",
		};
		mocks.readFile.mockResolvedValue(createPngBuffer(1000, 640));
		const ground = vi.fn().mockResolvedValue({
			method: "grounding" as const,
			provider: "test-provider",
			confidence: 0.97,
			reason: "Matched Send button",
			coordinateSpace: "image_pixels" as const,
			point: { x: 600, y: 200 },
			box: { x: 560, y: 160, width: 120, height: 80 },
		});
		const runtime = createRuntime(ground);

		const result = await runtime.click({
			app: "Mail",
			target: "Send button",
		});

		const clickCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "click",
		);
		expect(clickCall?.env.UNDERSTUDY_GUI_X).toBe("350");
		expect(clickCall?.env.UNDERSTUDY_GUI_Y).toBe("220");
		expect(result.details).toMatchObject({
			grounding_image_point: { x: 600, y: 200 },
			grounding_display_point: { x: 350, y: 220 },
			grounding_display_box: { x: 330, y: 200, width: 60, height: 40 },
			capture_rect: { x: 50, y: 120, width: 500, height: 320 },
			window_count: 2,
			window_capture_strategy: "app_union",
		});
	});

	it("rejects out-of-bounds image-space grounding instead of clicking the capture edge", async () => {
		const ground = vi.fn().mockResolvedValue({
			method: "grounding" as const,
			provider: "test-provider",
			confidence: 0.94,
			reason: "Matched outside the captured region",
			coordinateSpace: "image_pixels" as const,
			point: { x: 1200, y: 100 },
			box: { x: 1180, y: 80, width: 80, height: 40 },
		});
		const runtime = createRuntime(ground);

		const result = await runtime.click({
			target: "Send button",
		});

		expect(result.status).toEqual({
			code: "not_found",
			summary: "No confident visual GUI target was found.",
		});
		expect(result.details).toMatchObject({
			error:
				'Grounding resolved "Send button" to image-space point (1200, 100), but that point falls outside 800x600px.',
			grounding_resolution_error:
				'Grounding resolved "Send button" to image-space point (1200, 100), but that point falls outside 800x600px.',
		});
		expect(result.image?.mimeType).toBe("image/png");
		expect(mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "click",
		)).toBeUndefined();
	});

	it("does not replay out-of-bounds grounding diagnostics into the next click attempt", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce({
				method: "grounding" as const,
				provider: "test-provider",
				confidence: 0.94,
				reason: "Matched outside the captured region",
				coordinateSpace: "image_pixels" as const,
				point: { x: 1200, y: 100 },
			})
			.mockResolvedValueOnce(groundedTarget("Send button", { x: 48, y: 64 }, 0.9));
		const runtime = createRuntime(ground);

		await runtime.click({
			target: "Send button",
		});
		await runtime.click({
			target: "Send button",
		});

		const sendButtonCalls = ground.mock.calls
			.map((call) => call[0])
			.filter((params) => params?.target === "Send button");
		expect(sendButtonCalls).toHaveLength(2);
		expect(sendButtonCalls[1]).toMatchObject({
			groundingMode: undefined,
			previousFailures: [],
		});
	});

	it("sends a grounded click and returns evidence from the post-action capture", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Send button", { x: 48, y: 64 }, 0.92));
		const runtime = createRuntime(ground);

		const result = await runtime.click({
			app: "Mail",
			target: "Send button",
		});

		expect(result.status).toEqual({
			code: "action_sent",
			summary: "GUI click was sent.",
		});
		expect(result.text).toContain('Clicked "Send button"');
		expect(result.details).toMatchObject({
			action_kind: "cg_click",
			grounding_provider: "test-provider",
			capture_mode: "window",
			window_title: "Composer",
			executed_point: { x: 124, y: 232 },
		});
		expect(ground.mock.calls[0]?.[0]).toMatchObject({
			target: "Send button",
			action: "click",
			captureMode: "window",
			windowTitle: "Composer",
			previousFailures: [],
		});
		expect(mocks.execCalls.filter((call) => call.file === "osascript")).toHaveLength(0);
	});

	it("waits for the settle delay configured in the environment before capturing post-action evidence", async () => {
		vi.useFakeTimers();
		let clickPromise: Promise<Awaited<ReturnType<ComputerUseGuiRuntime["click"]>>> | undefined;
		try {
			process.env.UNDERSTUDY_GUI_POST_ACTION_CAPTURE_SETTLE_MS = "75";
			const ground = vi.fn()
				.mockResolvedValueOnce(groundedTarget("Send button", { x: 48, y: 64 }, 0.92));
			const runtime = new ComputerUseGuiRuntime({
				groundingProvider: { ground },
			});

			let settled = false;
			clickPromise = runtime.click({
				app: "Mail",
				target: "Send button",
			}).then((result) => {
				settled = true;
				return result;
			});

			await vi.advanceTimersByTimeAsync(0);
			expect(settled).toBe(false);
			expect(mocks.execCalls.filter((call) => call.file === "screencapture")).toHaveLength(1);
			expect(mocks.execCalls.filter((call) => call.file === "osascript")).toHaveLength(0);

			await vi.advanceTimersByTimeAsync(74);
			expect(settled).toBe(false);
			expect(mocks.execCalls.filter((call) => call.file === "screencapture")).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(1);
			const result = await clickPromise;

			expect(settled).toBe(true);
			expect(mocks.execCalls.filter((call) => call.file === "screencapture")).toHaveLength(2);
			expect(result.details).toMatchObject({
				post_action_capture_settle_ms: 75,
			});
		} finally {
			if (clickPromise) {
				await vi.runAllTimersAsync();
				await clickPromise.catch(() => undefined);
			}
			vi.useRealTimers();
		}
	});

	it("defaults to a 3s settle delay before capturing post-action evidence", async () => {
		vi.useFakeTimers();
		let clickPromise: Promise<Awaited<ReturnType<ComputerUseGuiRuntime["click"]>>> | undefined;
		try {
			delete process.env.UNDERSTUDY_GUI_POST_ACTION_CAPTURE_SETTLE_MS;
			const ground = vi.fn()
				.mockResolvedValueOnce(groundedTarget("Send button", { x: 48, y: 64 }, 0.92));
			const runtime = new ComputerUseGuiRuntime({
				groundingProvider: { ground },
			});

			let settled = false;
			clickPromise = runtime.click({
				app: "Mail",
				target: "Send button",
			}).then((result) => {
				settled = true;
				return result;
			});

			await vi.advanceTimersByTimeAsync(0);
			expect(settled).toBe(false);
			expect(mocks.execCalls.filter((call) => call.file === "screencapture")).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(2_999);
			expect(settled).toBe(false);
			expect(mocks.execCalls.filter((call) => call.file === "screencapture")).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(1);
			const result = await clickPromise;

			expect(settled).toBe(true);
			expect(mocks.execCalls.filter((call) => call.file === "screencapture")).toHaveLength(2);
			expect(result.details).toMatchObject({
				post_action_capture_settle_ms: 3_000,
			});
		} finally {
			if (clickPromise) {
				await vi.runAllTimersAsync();
				await clickPromise.catch(() => undefined);
			}
			vi.useRealTimers();
		}
	});

	it("reads the post-action settle delay from the environment", async () => {
		vi.useFakeTimers();
		let clickPromise: Promise<Awaited<ReturnType<ComputerUseGuiRuntime["click"]>>> | undefined;
		try {
			process.env.UNDERSTUDY_GUI_POST_ACTION_CAPTURE_SETTLE_MS = "1250";
			const ground = vi.fn()
				.mockResolvedValueOnce(groundedTarget("Send button", { x: 48, y: 64 }, 0.92));
			const runtime = new ComputerUseGuiRuntime({
				groundingProvider: { ground },
			});

			let settled = false;
			clickPromise = runtime.click({
				app: "Mail",
				target: "Send button",
			}).then((result) => {
				settled = true;
				return result;
			});

			await vi.advanceTimersByTimeAsync(0);
			expect(settled).toBe(false);
			expect(mocks.execCalls.filter((call) => call.file === "screencapture")).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(1_249);
			expect(settled).toBe(false);
			expect(mocks.execCalls.filter((call) => call.file === "screencapture")).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(1);
			const result = await clickPromise;

			expect(settled).toBe(true);
			expect(mocks.execCalls.filter((call) => call.file === "screencapture")).toHaveLength(2);
			expect(result.details).toMatchObject({
				post_action_capture_settle_ms: 1_250,
			});
		} finally {
			if (clickPromise) {
				await vi.runAllTimersAsync();
				await clickPromise.catch(() => undefined);
			}
			vi.useRealTimers();
		}
	});

	it("keeps each click grounding request stateless after a prior miss", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(groundedTarget("Send button", { x: 48, y: 64 }, 0.93));
		const runtime = createRuntime(ground);

		const firstResult = await runtime.click({
			app: "Mail",
			target: "Send button",
		});
		expect(firstResult.status.code).toBe("not_found");

		await runtime.click({
			app: "Mail",
			target: "Send button",
		});

		const sendButtonCalls = ground.mock.calls
			.map((call) => call[0])
			.filter((params) => params?.target === "Send button");
		expect(sendButtonCalls).toHaveLength(2);
		expect(sendButtonCalls[0]).toMatchObject({
			action: "click",
			groundingMode: undefined,
			previousFailures: [],
		});
		expect(sendButtonCalls[1]).toMatchObject({
			action: "click",
			groundingMode: undefined,
			previousFailures: [],
		});
	});

	it("keeps later click grounding requests stateless after a success", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(groundedTarget("Send button", { x: 48, y: 64 }, 0.93))
			.mockResolvedValueOnce(groundedTarget("Send button", { x: 48, y: 64 }, 0.94));
		const runtime = createRuntime(ground);

		await runtime.click({
			app: "Mail",
			target: "Send button",
		});
		await runtime.click({
			app: "Mail",
			target: "Send button",
		});
		await runtime.click({
			app: "Mail",
			target: "Send button",
		});

		const sendButtonCalls = ground.mock.calls
			.map((call) => call[0])
			.filter((params) => params?.target === "Send button");
		expect(sendButtonCalls).toHaveLength(3);
		expect(sendButtonCalls[1]).toMatchObject({
			groundingMode: undefined,
			previousFailures: [],
		});
		expect(sendButtonCalls[2]).toMatchObject({
			groundingMode: undefined,
			previousFailures: [],
		});
	});

	it("sends a grounded right click", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("File row", { x: 92, y: 140 }));
		const runtime = createRuntime(ground);

		const result = await runtime.click({
			target: "File row",
			button: "right",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_right_click",
			executed_point: { x: expect.any(Number), y: expect.any(Number) },
		});
	});

	it("sends a grounded double click", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Open item", { x: 80, y: 96 }));
		const runtime = createRuntime(ground);

		const result = await runtime.click({
			target: "Open item",
			clicks: 2,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_double_click",
			executed_point: { x: expect.any(Number), y: expect.any(Number) },
		});
	});

	it("keeps the pointer on a grounded hover target", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Info icon", { x: 160, y: 104 }));
		const runtime = createRuntime(ground);

		const result = await runtime.click({
			target: "Info icon",
			button: "none",
			settleMs: 320,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_hover",
			settle_ms: 320,
			executed_point: { x: expect.any(Number), y: expect.any(Number) },
		});
		const hoverCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "hover",
		);
		expect(hoverCall?.env.UNDERSTUDY_GUI_SETTLE_MS).toBe("320");
	});

	it("clicks and holds a grounded target", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Record button", { x: 220, y: 180 }));
		const runtime = createRuntime(ground);

		const result = await runtime.click({
			target: "Record button",
			groundingMode: "complex",
			holdMs: 900,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_click_and_hold",
			hold_duration_ms: 900,
			executed_point: { x: expect.any(Number), y: expect.any(Number) },
		});
		const holdCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "click_and_hold",
		);
		expect(holdCall?.env.UNDERSTUDY_GUI_HOLD_DURATION_MS).toBe("900");
		expect(ground).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				target: "Record button",
				groundingMode: "complex",
			}),
		);
	});

	it("sends drag actions and records destination grounding", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Card A", { x: 64, y: 88 }))
			.mockResolvedValueOnce(groundedTarget("Done column", { x: 280, y: 92 }, 0.9));
		const runtime = createRuntime(ground);

		const result = await runtime.drag({
			fromTarget: "Card A",
			toTarget: "Done column",
			durationMs: 600,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_drag",
			grounding_provider: "test-provider",
			destination_target_resolution: {
				grounding_provider: "test-provider",
			},
			executed_from_point: { x: 132, y: 244 },
			executed_to_point: { x: expect.any(Number), y: expect.any(Number) },
		});
		expect(ground.mock.calls[0]?.[0]).toMatchObject({
			action: "drag_source",
			groundingMode: "complex",
			relatedTarget: "Done column",
			relatedScope: undefined,
			relatedAction: "drag_destination",
		});
		expect(ground.mock.calls[1]?.[0]).toMatchObject({
			action: "drag_destination",
			groundingMode: "complex",
			relatedTarget: "Card A",
			relatedAction: "drag_source",
			relatedPoint: { x: 132, y: 244 },
		});
		const dragCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "drag",
		);
		expect(dragCall?.env.UNDERSTUDY_GUI_ACTIVATE_APP).toBe("1");
	});

	it("uses display capture for cross-window drag targets and propagates destination hints", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget('file "Budget.csv"', { x: 64, y: 88 }))
			.mockResolvedValueOnce(groundedTarget("Trash icon in the Dock", { x: 720, y: 560 }, 0.88));
		const runtime = createRuntime(ground);

		const result = await runtime.drag({
			app: "Finder",
			fromTarget: 'file "Budget.csv"',
			toTarget: "Trash icon in the Dock",
			fromLocationHint: "bottom half of the Finder window",
			toLocationHint: "far right side of the Dock",
			captureMode: "display",
			durationMs: 750,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_drag",
			capture_mode: "display",
			executed_from_point: { x: 64, y: 88 },
			executed_to_point: { x: 720, y: 560 },
		});
		expect(ground.mock.calls[0]?.[0]).toMatchObject({
			action: "drag_source",
			target: 'file "Budget.csv"',
			captureMode: "display",
			locationHint: "bottom half of the Finder window",
			relatedTarget: "Trash icon in the Dock",
			relatedLocationHint: "far right side of the Dock",
		});
		expect(ground.mock.calls[1]?.[0]).toMatchObject({
			action: "drag_destination",
			target: "Trash icon in the Dock",
			captureMode: "display",
			locationHint: "far right side of the Dock",
			relatedTarget: 'file "Budget.csv"',
			relatedLocationHint: "bottom half of the Finder window",
			relatedPoint: { x: 64, y: 88 },
		});
	});

	it("returns a not_found result when drag destination grounding fails after resolving the source", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Card A", { x: 64, y: 88 }))
			.mockResolvedValueOnce(undefined);
		const runtime = createRuntime(ground);

		const result = await runtime.drag({
			fromTarget: "Card A",
			toTarget: 'the drop zone between "Doing" and "Done"',
			toLocationHint: "between the second and third columns",
		});

		expect(result.status).toEqual({
			code: "not_found",
			summary: "No confident visual drag destination was found.",
		});
		expect(result.text).toContain('Could not visually resolve a drag destination matching "the drop zone between "Doing" and "Done"".');
		expect(result.details).toMatchObject({
			error: "No confident visual drag destination was found.",
			confidence: 0,
			capture_mode: "window",
			window_title: "Composer",
		});
		expect(ground).toHaveBeenCalledTimes(2);
		expect(mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "drag",
		)).toBeUndefined();
	});

	it("sends scroll actions against a grounded target", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Transcript panel", { x: 320, y: 400 }));
		const runtime = createRuntime(ground);

		const result = await runtime.scroll({
			target: "Transcript panel",
			direction: "down",
			amount: 8,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_scroll",
			direction: "down",
			amount: 8,
			scroll_distance: "custom",
			scroll_unit: "line",
			executed_point: { x: expect.any(Number), y: expect.any(Number) },
		});
	});

	it("defaults targetless scrolls to a page-like semantic distance", async () => {
		const ground = vi.fn();
		const runtime = createRuntime(ground);

		const result = await runtime.scroll({
			direction: "down",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_scroll",
			direction: "down",
			amount: 225,
			scroll_distance: "page",
			scroll_unit: "pixel",
			scroll_viewport_dimension: 300,
			scroll_viewport_source: "window",
			scroll_travel_fraction: 0.75,
			grounding_method: "targetless",
		});
		expect(ground).not.toHaveBeenCalled();
		const scrollCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "scroll",
		);
		const contextCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "capture-context",
		);
		expect(contextCall).toBeTruthy();
		expect(scrollCall?.env.UNDERSTUDY_GUI_SCROLL_UNIT).toBe("pixel");
		expect(scrollCall?.env.UNDERSTUDY_GUI_SCROLL_Y).toBe("-225");
	});

	it("activates the requested app for targetless scrolls", async () => {
		const ground = vi.fn();
		const runtime = createRuntime(ground);

		const result = await runtime.scroll({
			app: "Safari",
			direction: "down",
		});

		expect(result.status.code).toBe("action_sent");
		expect(ground).not.toHaveBeenCalled();
		const scrollCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "scroll",
		);
		expect(scrollCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "Safari",
			UNDERSTUDY_GUI_ACTIVATE_APP: "1",
		});
	});

	it("focuses a grounded target before typing", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Composer", { x: 300, y: 500 }));
		const runtime = createRuntime(ground);

		const result = await runtime.type({
			target: "Composer",
			value: "hello world",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "typed",
			executed_point: { x: expect.any(Number), y: expect.any(Number) },
		});
		expect(ground.mock.calls[0]?.[0]).toMatchObject({
			action: "type",
			groundingMode: "complex",
		});
		expect(mocks.execCalls.map((call) => call.file)).toContain(MOCK_NATIVE_HELPER_PATH);
		expect(mocks.execCalls.map((call) => call.file)).toContain("osascript");
		const focusClickCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "click",
		);
		expect(focusClickCall?.env.UNDERSTUDY_GUI_ACTIVATE_APP).toBe("1");
	});

	it("focuses the center of a grounded box before typing", async () => {
		const ground = vi.fn().mockResolvedValueOnce({
			method: "grounding" as const,
			provider: "test-provider",
			confidence: 0.92,
			reason: "Matched Composer",
			coordinateSpace: "image_pixels" as const,
			point: { x: 20, y: 20 },
			box: {
				x: 40,
				y: 20,
				width: 120,
				height: 40,
			},
		});
		const runtime = createRuntime(ground);

		const result = await runtime.type({
			target: "Composer",
			value: "hello world",
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "typed",
			executed_point: { x: 150, y: 220 },
		});
		const focusClickCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "click",
		);
		expect(focusClickCall?.env).toMatchObject({
			UNDERSTUDY_GUI_X: "150",
			UNDERSTUDY_GUI_Y: "220",
		});
	});

	it("passes window selection through to targetless typing", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			windowTitle: "Draft 2",
			windowBounds: { x: 140, y: 260, width: 520, height: 360 },
		};
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "Mail",
			value: "hello world",
			windowSelector: {
				titleContains: "Draft",
				index: 2,
			},
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			grounding_method: "targetless",
		});
		const captureCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "capture-context",
		);
		expect(captureCall?.env).toMatchObject({
			UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS: "Draft",
			UNDERSTUDY_GUI_WINDOW_INDEX: "2",
		});
			const typeCall = mocks.execCalls.find((call) =>
				call.file === "osascript" &&
				call.args.includes("--") &&
				call.args.at(-1) === "hello world",
			);
			expect(typeCall?.env).toMatchObject({
				UNDERSTUDY_GUI_WINDOW_TITLE: "Draft 2",
				UNDERSTUDY_GUI_WINDOW_BOUNDS_X: "140",
			UNDERSTUDY_GUI_WINDOW_BOUNDS_Y: "260",
			UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH: "520",
			UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT: "360",
			});
			expect(typeCall?.env.UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS).toBeUndefined();
			expect(typeCall?.env.UNDERSTUDY_GUI_WINDOW_INDEX).toBeUndefined();
			expect(typeCall?.env.UNDERSTUDY_GUI_TEXT).toBeUndefined();
		});

	it("passes non-ASCII text to osascript via argv so unicode input stays intact", async () => {
		const runtime = createRuntime(vi.fn());

		await runtime.type({
			value: "你好，世界",
		});

		const typeCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.args.includes("--") &&
			call.args.at(-1) === "你好，世界",
		);
		expect(typeCall?.env.UNDERSTUDY_GUI_TEXT).toBeUndefined();
		expect(typeCall?.args.slice(-2)).toEqual(["--", "你好，世界"]);
	});

	it("uses physical_keys native text entry when typeStrategy is set", async () => {
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			value: "flow free",
			typeStrategy: "physical_keys",
			submit: true,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_type_text",
			grounding_method: "targetless",
			app: "SomeApp",
		});
		const nativeTypeCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "type_text",
		);
		expect(nativeTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "SomeApp",
			UNDERSTUDY_GUI_TEXT: "flow free",
			UNDERSTUDY_GUI_REPLACE: "1",
			UNDERSTUDY_GUI_SUBMIT: "1",
			UNDERSTUDY_GUI_TYPE_STRATEGY: "physical_keys",
			UNDERSTUDY_GUI_CLEAR_REPEAT: "48",
		});
		const appleScriptTypeCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.args.includes("--") &&
			call.args[call.args.indexOf("--") + 1] === "flow free",
		);
		expect(appleScriptTypeCall).toBeUndefined();
	});

	it("uses clipboard_paste native text entry when typeStrategy is set", async () => {
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			value: "倒数日",
			typeStrategy: "clipboard_paste",
			submit: true,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_type_text",
			grounding_method: "targetless",
			app: "SomeApp",
		});
		const nativeTypeCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "type_text" &&
			call.env.UNDERSTUDY_GUI_TEXT === "倒数日",
		);
		expect(nativeTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "SomeApp",
			UNDERSTUDY_GUI_TEXT: "倒数日",
			UNDERSTUDY_GUI_REPLACE: "1",
			UNDERSTUDY_GUI_SUBMIT: "1",
			UNDERSTUDY_GUI_TYPE_STRATEGY: "clipboard_paste",
			UNDERSTUDY_GUI_CLEAR_REPEAT: "48",
		});
		const appleScriptTypeCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.args.includes("--") &&
			call.args.at(-1) === "倒数日",
		);
		expect(appleScriptTypeCall).toBeUndefined();
	});

	it("uses system_events_paste without exposing the text as an osascript argv value", async () => {
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			value: "S3cret!Pass",
			typeStrategy: "system_events_paste",
			submit: false,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "typed",
			grounding_method: "targetless",
			app: "SomeApp",
		});
		const appleScriptTypeCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.env.UNDERSTUDY_GUI_TEXT === "S3cret!Pass",
		);
		expect(appleScriptTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "SomeApp",
			UNDERSTUDY_GUI_TEXT: "S3cret!Pass",
			UNDERSTUDY_GUI_REPLACE: "1",
			UNDERSTUDY_GUI_SUBMIT: "0",
			UNDERSTUDY_GUI_PASTE_PRE_DELAY_MS: "220",
			UNDERSTUDY_GUI_PASTE_POST_DELAY_MS: "650",
		});
		expect(appleScriptTypeCall?.args).not.toContain("S3cret!Pass");
		const nativeTypeCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "type_text" &&
			call.env.UNDERSTUDY_GUI_TEXT === "S3cret!Pass",
		);
		expect(nativeTypeCall).toBeUndefined();
	});

	it("uses system_events_keystroke without exposing the text as an osascript argv value", async () => {
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			value: "S3cret!Pass",
			typeStrategy: "system_events_keystroke",
			replace: false,
			submit: false,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "typed",
			grounding_method: "targetless",
			app: "SomeApp",
		});
		const appleScriptTypeCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.env.UNDERSTUDY_GUI_TEXT === "S3cret!Pass" &&
			call.env.UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY === "keystroke",
		);
		expect(appleScriptTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "SomeApp",
			UNDERSTUDY_GUI_TEXT: "S3cret!Pass",
			UNDERSTUDY_GUI_REPLACE: "0",
			UNDERSTUDY_GUI_SUBMIT: "0",
			UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY: "keystroke",
			UNDERSTUDY_GUI_PASTE_PRE_DELAY_MS: "220",
			UNDERSTUDY_GUI_PASTE_POST_DELAY_MS: "650",
		});
		expect(appleScriptTypeCall?.args).not.toContain("S3cret!Pass");
		const nativeTypeCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "type_text" &&
			call.env.UNDERSTUDY_GUI_TEXT === "S3cret!Pass",
		);
		expect(nativeTypeCall).toBeUndefined();
	});

	it("uses system_events_keystroke_chars without exposing the text as an osascript argv value", async () => {
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			value: "Aa#%1@Bb",
			typeStrategy: "system_events_keystroke_chars",
			replace: false,
			submit: false,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "typed",
			grounding_method: "targetless",
			app: "SomeApp",
		});
		const appleScriptTypeCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.env.UNDERSTUDY_GUI_TEXT === "Aa#%1@Bb" &&
			call.env.UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY === "keystroke_chars",
		);
		expect(appleScriptTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "SomeApp",
			UNDERSTUDY_GUI_TEXT: "Aa#%1@Bb",
			UNDERSTUDY_GUI_REPLACE: "0",
			UNDERSTUDY_GUI_SUBMIT: "0",
			UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY: "keystroke_chars",
			UNDERSTUDY_GUI_KEYSTROKE_CHAR_DELAY_MS: "55",
		});
		expect(appleScriptTypeCall?.args).not.toContain("Aa#%1@Bb");
	});

	it("types text from a secret env var without requiring a literal gui_type value", async () => {
		process.env.UNDERSTUDY_TEST_GUI_SECRET = "secret-from-env";
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			secretEnvVar: "UNDERSTUDY_TEST_GUI_SECRET",
			typeStrategy: "physical_keys",
			submit: true,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_type_text",
			grounding_method: "targetless",
			app: "SomeApp",
			input_source: "secret_env",
		});
		const nativeTypeCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "type_text" &&
			call.env.UNDERSTUDY_GUI_TEXT === "secret-from-env",
		);
		expect(nativeTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_TEXT: "secret-from-env",
			UNDERSTUDY_GUI_SUBMIT: "1",
		});
	});

	it("types text from a secret command env var without exposing a literal gui_type value", async () => {
		process.env.UNDERSTUDY_TEST_GUI_SECRET_COMMAND = "printf 'secret-from-command\\n'";
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			secretCommandEnvVar: "UNDERSTUDY_TEST_GUI_SECRET_COMMAND",
			typeStrategy: "clipboard_paste",
			submit: true,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_type_text",
			grounding_method: "targetless",
			app: "SomeApp",
			input_source: "secret_command_env",
		});
			expect(mocks.execCalls.find((call) =>
				(
					call.file === "zsh" ||
					call.file === "/bin/zsh" ||
					call.file === "bash" ||
					call.file === "/bin/bash"
				) &&
				call.args.includes("-lc") &&
				call.args.at(-1) === "printf 'secret-from-command\\n'",
			)).toBeTruthy();
		const nativeTypeCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "type_text" &&
			call.env.UNDERSTUDY_GUI_TEXT === "secret-from-command",
		);
		expect(nativeTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_TEXT: "secret-from-command",
			UNDERSTUDY_GUI_SUBMIT: "1",
		});
	});

	it("types secret env text through system_events_paste without placing the secret on osascript argv", async () => {
		process.env.UNDERSTUDY_TEST_GUI_SECRET = "secret-from-env";
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			secretEnvVar: "UNDERSTUDY_TEST_GUI_SECRET",
			typeStrategy: "system_events_paste",
			submit: false,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "typed",
			grounding_method: "targetless",
			app: "SomeApp",
			input_source: "secret_env",
		});
		const appleScriptTypeCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.env.UNDERSTUDY_GUI_TEXT === "secret-from-env",
		);
		expect(appleScriptTypeCall?.args).not.toContain("secret-from-env");
		expect(appleScriptTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "SomeApp",
			UNDERSTUDY_GUI_TEXT: "secret-from-env",
			UNDERSTUDY_GUI_SUBMIT: "0",
		});
	});

	it("types secret env text through system_events_keystroke without placing the secret on osascript argv", async () => {
		process.env.UNDERSTUDY_TEST_GUI_SECRET = "secret-from-env";
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			secretEnvVar: "UNDERSTUDY_TEST_GUI_SECRET",
			typeStrategy: "system_events_keystroke",
			replace: false,
			submit: false,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "typed",
			grounding_method: "targetless",
			app: "SomeApp",
			input_source: "secret_env",
		});
		const appleScriptTypeCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.env.UNDERSTUDY_GUI_TEXT === "secret-from-env" &&
			call.env.UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY === "keystroke",
		);
		expect(appleScriptTypeCall?.args).not.toContain("secret-from-env");
		expect(appleScriptTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "SomeApp",
			UNDERSTUDY_GUI_TEXT: "secret-from-env",
			UNDERSTUDY_GUI_REPLACE: "0",
			UNDERSTUDY_GUI_SUBMIT: "0",
			UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY: "keystroke",
		});
	});

	it("types secret env text through system_events_keystroke_chars without placing the secret on osascript argv", async () => {
		process.env.UNDERSTUDY_TEST_GUI_SECRET = "secret-from-env";
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "SomeApp",
			secretEnvVar: "UNDERSTUDY_TEST_GUI_SECRET",
			typeStrategy: "system_events_keystroke_chars",
			replace: false,
			submit: false,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "typed",
			grounding_method: "targetless",
			app: "SomeApp",
			input_source: "secret_env",
		});
		const appleScriptTypeCall = mocks.execCalls.find((call) =>
			call.file === "osascript" &&
			call.env.UNDERSTUDY_GUI_TEXT === "secret-from-env" &&
			call.env.UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY === "keystroke_chars",
		);
		expect(appleScriptTypeCall?.args).not.toContain("secret-from-env");
		expect(appleScriptTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "SomeApp",
			UNDERSTUDY_GUI_TEXT: "secret-from-env",
			UNDERSTUDY_GUI_REPLACE: "0",
			UNDERSTUDY_GUI_SUBMIT: "0",
			UNDERSTUDY_GUI_SYSTEM_EVENTS_TYPE_STRATEGY: "keystroke_chars",
			UNDERSTUDY_GUI_KEYSTROKE_CHAR_DELAY_MS: "55",
		});
	});

	it("falls back to native text entry when AppleScript typing fails", async () => {
		mocks.failAppleScriptType = true;
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			app: "Mail",
			value: "flow free",
			submit: true,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "cg_type_text",
			grounding_method: "targetless",
			app: "Mail",
		});
		const nativeTypeCall = mocks.execCalls.find((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH &&
			call.args[0] === "event" &&
			call.env.UNDERSTUDY_GUI_EVENT_MODE === "type_text" &&
			call.env.UNDERSTUDY_GUI_APP === "Mail",
		);
		expect(nativeTypeCall?.env).toMatchObject({
			UNDERSTUDY_GUI_APP: "Mail",
			UNDERSTUDY_GUI_TEXT: "flow free",
			UNDERSTUDY_GUI_REPLACE: "1",
			UNDERSTUDY_GUI_SUBMIT: "1",
		});
		expect(nativeTypeCall?.env.UNDERSTUDY_GUI_TYPE_STRATEGY).toBeUndefined();
		expect(nativeTypeCall?.env.UNDERSTUDY_GUI_CLEAR_REPEAT).toBeUndefined();
	});

	it("sends key actions with modifiers", async () => {
		const ground = vi.fn();
		const runtime = createRuntime(ground);

		const result = await runtime.key({
			key: "k",
			modifiers: ["command"],
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "key_event",
			repeat: 1,
			grounding_method: "targetless",
		});
		expect(ground).not.toHaveBeenCalled();
	});

	it("sends key actions with repeat", async () => {
		const ground = vi.fn();
		const runtime = createRuntime(ground);

		const result = await runtime.key({
			key: "ArrowDown",
			repeat: 2,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.details).toMatchObject({
			action_kind: "key_event",
			repeat: 2,
			grounding_method: "targetless",
		});
		expect(ground).not.toHaveBeenCalled();
		const keyCall = mocks.execCalls.find((call) => call.file === "osascript" && call.env.UNDERSTUDY_GUI_REPEAT === "2");
		expect(keyCall?.env.UNDERSTUDY_GUI_KEY_CODE).toBe("125");
		expect(keyCall?.env.UNDERSTUDY_GUI_KEY).toBe("");
	});

	it("routes selected-window special keys through key codes", async () => {
		mocks.captureContextPayload = {
			...mocks.captureContextPayload,
			windowTitle: "Draft 1",
			windowBounds: { x: 120, y: 240, width: 500, height: 340 },
		};
		const runtime = createRuntime(vi.fn());

		const result = await runtime.key({
			app: "Mail",
			key: "Page Down",
			windowSelector: {
				titleContains: "Draft",
				index: 1,
			},
		});

		expect(result.status.code).toBe("action_sent");
		const keyCall = mocks.execCalls.find((call) => call.file === "osascript" && call.env.UNDERSTUDY_GUI_KEY_CODE === "121");
		expect(keyCall?.env).toMatchObject({
			UNDERSTUDY_GUI_WINDOW_TITLE: "Draft 1",
			UNDERSTUDY_GUI_WINDOW_BOUNDS_X: "120",
			UNDERSTUDY_GUI_WINDOW_BOUNDS_Y: "240",
			UNDERSTUDY_GUI_WINDOW_BOUNDS_WIDTH: "500",
			UNDERSTUDY_GUI_WINDOW_BOUNDS_HEIGHT: "340",
			UNDERSTUDY_GUI_KEY: "",
		});
		expect(keyCall?.env.UNDERSTUDY_GUI_WINDOW_TITLE_CONTAINS).toBeUndefined();
		expect(keyCall?.env.UNDERSTUDY_GUI_WINDOW_INDEX).toBeUndefined();
	});

	it("aborts gui_wait when the emergency stop monitor fires", async () => {
		const stop = vi.fn().mockResolvedValue(undefined);
		const runtime = new ComputerUseGuiRuntime({
			groundingProvider: { ground: vi.fn().mockResolvedValue(undefined) },
			physicalResourceLock: null,
			emergencyStopProvider: {
				start: vi.fn().mockImplementation(async ({ onEmergencyStop }) => {
					queueMicrotask(() => {
						onEmergencyStop();
					});
					return { stop };
				}),
			},
		});

		await expect(runtime.wait({
			target: "Finished badge",
			timeoutMs: 100,
			intervalMs: 0,
		})).rejects.toMatchObject({
			name: "AbortError",
			message: "GUI action aborted after Escape was pressed.",
		});
		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("does not abort gui_key when Escape is the intended keypress", async () => {
		const stop = vi.fn().mockResolvedValue(undefined);
		const runtime = new ComputerUseGuiRuntime({
			physicalResourceLock: null,
			emergencyStopProvider: {
				start: vi.fn().mockImplementation(async ({ onEmergencyStop }) => {
					setTimeout(() => {
						onEmergencyStop();
					}, 0);
					return { stop };
				}),
			},
		});

		const result = await runtime.key({
			key: "Escape",
		});

		expect(result.status.code).toBe("action_sent");
		expect(stop).toHaveBeenCalledTimes(1);
	});

	it("runs input cleanup when a GUI key action aborts", async () => {
		const runtime = new ComputerUseGuiRuntime({
			physicalResourceLock: null,
			emergencyStopProvider: {
				start: vi.fn().mockImplementation(async ({ onEmergencyStop }) => {
					queueMicrotask(() => {
						onEmergencyStop();
					});
					return {
						stop: vi.fn().mockResolvedValue(undefined),
					};
				}),
			},
		});

		await expect(runtime.key({
			key: "Enter",
		})).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(mocks.execCalls.some((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH && call.args[0] === "cleanup",
		)).toBe(true);
	});

	it("reports cursor moves with move-specific telemetry", async () => {
		const runtime = createRuntime(vi.fn());

		const result = await runtime.move({
			x: 100,
			y: 200,
		});

		expect(result.status.code).toBe("action_sent");
		expect(result.text).toContain("cg_move");
		expect(result.details).toMatchObject({
			action_kind: "cg_move",
			grounding_method: "absolute_coordinates",
			executed_point: { x: 100, y: 200 },
		});
	});

	it("refuses mutating actions when another session holds the physical GUI lock", async () => {
		const runtime = createRuntime(vi.fn(), {
			physicalResourceLock: {
				acquire: vi.fn().mockResolvedValue({
					state: "blocked",
					holder: {
						sessionId: "other-session",
						pid: 4242,
						toolName: "gui_click",
					},
				}),
				release: vi.fn().mockResolvedValue(false),
			},
		});

		const result = await runtime.move({
			x: 100,
			y: 200,
		});

		expect(result.status).toEqual({
			code: "unsupported",
			summary: "GUI physical resources are currently locked by tool gui_click, pid 4242.",
		});
		expect(mocks.execCalls).toEqual([]);
	});

	it("waits for a grounded target to appear", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Finished badge", { x: 480, y: 220 }, 0.93))
			.mockResolvedValueOnce(groundedTarget("Finished badge", { x: 481, y: 221 }, 0.94));
		const runtime = createRuntime(ground);

		const result = await runtime.wait({
			target: "Finished badge",
			timeoutMs: 20,
			intervalMs: 0,
		});

		expect(result.status).toEqual({
			code: "condition_met",
			summary: "Target appeared.",
		});
		expect(result.details).toMatchObject({
			attempts: 2,
			wait_confirmations_required: 2,
			grounding_provider: "test-provider",
		});
		expect(ground.mock.calls[0]?.[0]).toMatchObject({
			action: "wait",
		});
		// wait should not default to "complex" — its validation round is always
		// suppressed in the provider, so requesting "complex" would be misleading.
		expect(ground.mock.calls[0]?.[0].groundingMode).toBeUndefined();
	});

	it("uses window-scoped captures for gui_wait on Windows when grounding is available", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
			groundingProvider: {
				ground: vi.fn().mockResolvedValue(groundedTarget("Finished badge", { x: 48, y: 64 }, 0.93)),
			},
		});

		const result = await runtime.wait({
			target: "Finished badge",
			captureMode: "window",
			windowTitle: "Settings",
			timeoutMs: 50,
			intervalMs: 0,
		});

		expect(result.status.code).toBe("condition_met");
		expect(result.details).toMatchObject({
			capture_mode: "window",
			window_title: "Settings",
		});
	});

	it("rejects window index selection for gui_wait on Windows", async () => {
		const runtime = new ComputerUseGuiRuntime({
			platform: "win32",
			groundingProvider: { ground: vi.fn() },
		});

		const result = await runtime.wait({
			target: "Finished badge",
			windowSelector: { titleContains: "Settings", index: 2 },
		});

		expect(result.status).toEqual({
			code: "unsupported",
			summary: "Windows GUI wait does not support window index selection yet. Omit `windowSelector.index`.",
		});
		expect(mocks.execCalls).toEqual([]);
	});

	it("restores the clipboard snapshot after clipboard-based gui_type cleanup", async () => {
		mocks.clipboardText = "copied before";
		const runtime = createRuntime(vi.fn());

		const result = await runtime.type({
			value: "hello",
			typeStrategy: "clipboard_paste",
		});

		expect(result.status.code).toBe("action_sent");
		expect(mocks.clipboardText).toBe("copied before");
		expect(mocks.execCalls.some((call) =>
			call.file === MOCK_NATIVE_HELPER_PATH && call.args[0] === "cleanup",
		)).toBe(true);
		expect(mocks.execCalls.some((call) =>
			call.file === "osascript" &&
			typeof call.args[3] === "string" &&
			call.args[3].includes("set the clipboard to restoredText"),
		)).toBe(true);
	});

	it("falls back to display capture for later app-scoped wait probes when window probes keep missing", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(groundedTarget("Finished badge", { x: 480, y: 220 }, 0.93))
			.mockResolvedValueOnce(groundedTarget("Finished badge", { x: 481, y: 221 }, 0.94));
		const runtime = createRuntime(ground);

		const result = await runtime.wait({
			app: "Safari",
			target: "Finished badge",
			timeoutMs: 50,
			intervalMs: 0,
		});

		expect(result.status).toEqual({
			code: "condition_met",
			summary: "Target appeared.",
		});
		expect(ground.mock.calls[0]?.[0]).toMatchObject({
			action: "wait",
			captureMode: "window",
		});
		expect(ground.mock.calls[0]?.[0].groundingMode).toBeUndefined();
		expect(ground.mock.calls[1]?.[0]).toMatchObject({
			action: "wait",
			captureMode: "display",
		});
		expect(ground.mock.calls[2]?.[0]).toMatchObject({
			action: "wait",
			captureMode: "display",
		});
	});

	it("waits for a grounded target to disappear after consecutive misses", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Uploading badge", { x: 420, y: 180 }, 0.91))
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined);
		const runtime = createRuntime(ground);

		const result = await runtime.wait({
			target: "Uploading badge",
			state: "disappear",
			timeoutMs: 20,
			intervalMs: 0,
		});

		expect(result.status).toEqual({
			code: "condition_met",
			summary: "Target disappeared.",
		});
		expect(result.details).toMatchObject({
			attempts: 3,
			wait_confirmations_required: 2,
			grounding_method: "grounding",
			confidence: 0,
		});
		expect(ground.mock.calls[0]?.[0]).toMatchObject({
			action: "wait",
		});
	});

	it("does not satisfy an appear wait on a single flickering detection", async () => {
		const ground = vi.fn()
			.mockResolvedValueOnce(groundedTarget("Finished badge", { x: 480, y: 220 }, 0.93))
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(groundedTarget("Finished badge", { x: 482, y: 222 }, 0.94))
			.mockResolvedValueOnce(groundedTarget("Finished badge", { x: 483, y: 223 }, 0.95));
		const runtime = createRuntime(ground);

		const result = await runtime.wait({
			target: "Finished badge",
			timeoutMs: 20,
			intervalMs: 0,
		});

		expect(result.status).toEqual({
			code: "condition_met",
			summary: "Target appeared.",
		});
		expect(result.details).toMatchObject({
			attempts: 4,
			wait_confirmations_required: 2,
			grounding_provider: "test-provider",
		});
	});

	it("times out when a wait target never satisfies the requested state", async () => {
		const ground = vi.fn().mockResolvedValue(undefined);
		const runtime = createRuntime(ground);

		const result = await runtime.wait({
			target: "Finished badge",
			timeoutMs: 0,
			intervalMs: 0,
		});

		expect(result.status).toEqual({
			code: "timeout",
			summary: "GUI wait timed out.",
		});
		expect(result.text).toContain('Timed out waiting for "Finished badge" to appear.');
		expect(typeof result.details?.attempts).toBe("number");
		expect((result.details?.attempts as number)).toBeGreaterThanOrEqual(1);
		expect(result.details).toMatchObject({
			wait_confirmations_required: 2,
			grounding_method: "grounding",
			confidence: 0,
		});
	});

	it("does not start grounding after a capture overruns the remaining wait budget", async () => {
		const ground = vi.fn();
		const runtime = createRuntime(ground);
		const dateNowSpy = vi.spyOn(Date, "now");
		const nowValues = [1000, 1025, 1025, 1025];
		dateNowSpy.mockImplementation(() => nowValues.shift() ?? 1025);

		try {
			const result = await runtime.wait({
				target: "Finished badge",
				timeoutMs: 20,
				intervalMs: 0,
			});

			expect(result.status).toEqual({
				code: "timeout",
				summary: "GUI wait timed out.",
			});
			expect(result.details).toMatchObject({
				attempts: 1,
				wait_confirmations_required: 2,
				grounding_method: "grounding",
				confidence: 0,
			});
			expect(ground).not.toHaveBeenCalled();
		} finally {
			dateNowSpy.mockRestore();
		}
	});
});
