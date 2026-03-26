import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import {
	wrapToolsWithWatchdog,
} from "../runtime/tool-watchdog.js";
import {
	buildPreflightPromptContent,
	runRuntimePreflight,
	type RuntimeCapabilityManifest,
} from "../runtime/preflight.js";

function createManifest(overrides?: Partial<RuntimeCapabilityManifest>): RuntimeCapabilityManifest {
	return {
		profile: "assistant",
		dependencies: {},
		toolAvailability: {},
		enabledToolNames: [],
		warnings: [],
		blockedInstallPackages: [],
		...overrides,
	};
}

const testDir = dirname(fileURLToPath(import.meta.url));
const appCliDir = resolve(testDir, "../../../../apps/cli");

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("runRuntimePreflight", () => {
	it("passes when tools have no dependency checks", () => {
		const manifest = runRuntimePreflight({
			profile: "assistant",
			toolNames: ["read", "bash"],
		});

		expect(manifest.enabledToolNames).toContain("read");
		expect(manifest.enabledToolNames).toContain("bash");
		expect(manifest.warnings).toHaveLength(0);
	});

	it("formats warning prompt content", () => {
		const text = buildPreflightPromptContent(
			createManifest({
				warnings: ["Tool browser disabled by preflight (playwright unavailable)."],
				blockedInstallPackages: ["playwright"],
			}),
		);

		expect(text).toContain("Runtime preflight warnings");
		expect(text).toContain("Tool browser disabled");
		expect(text).toContain("do not attempt package installs");
	});

	it("does not preflight-disable GUI tools based on grounding env", () => {
		vi.unstubAllEnvs();
		delete process.env.ARK_API_KEY;
		delete process.env.VOLCENGINE_ARK_API_KEY;
		delete process.env.SEED_API_KEY;
		delete process.env.UNDERSTUDY_GUI_GROUNDING_PROVIDER;

		const manifest = runRuntimePreflight({
			profile: "assistant",
			toolNames: ["gui_observe", "gui_click", "gui_wait"],
		});

		expect(manifest.toolAvailability.gui_observe?.enabled).toBe(true);
		expect(manifest.toolAvailability.gui_click?.enabled).toBe(true);
		expect(manifest.toolAvailability.gui_wait?.enabled).toBe(true);
		expect(manifest.warnings).toHaveLength(0);
	});

	it("detects workspace dependency availability when cwd is apps/cli", () => {
		const previousCwd = process.cwd();
		process.chdir(appCliDir);
		try {
			const manifest = runRuntimePreflight({
				profile: "assistant",
				toolNames: ["schedule"],
			});
			expect(manifest.toolAvailability.schedule?.enabled).toBe(true);
			expect(manifest.warnings).toHaveLength(0);
		} finally {
			process.chdir(previousCwd);
		}
	});
});

describe("wrapToolsWithWatchdog", () => {
	it("returns deterministic preflight error for disabled tool", async () => {
		const tool: AgentTool<any> = {
			name: "browser",
			label: "Browser",
			description: "Browser",
			parameters: Type.Object({}),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "ok" }],
				details: {},
			})),
		};

		const [wrapped] = wrapToolsWithWatchdog([tool], {
			runtimeProfile: "assistant",
			preflight: createManifest({
				toolAvailability: {
					browser: { enabled: false, reason: "missing dependency: playwright" },
				},
			}),
		});

		const result = await wrapped.execute("id1", {});
		expect((result.content[0] as { text: string }).text).toContain("Tool unavailable: browser");
		expect((result.details as any).error).toBe("preflight_unavailable");
		expect(tool.execute).not.toHaveBeenCalled();
	});

	it("blocks assistant install loops for missing dependencies", async () => {
		const tool: AgentTool<any> = {
			name: "bash",
			label: "Bash",
			description: "Bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "ok" }],
				details: {},
			})),
		};

		const [wrapped] = wrapToolsWithWatchdog([tool], {
			runtimeProfile: "assistant",
			preflight: createManifest({
				blockedInstallPackages: ["playwright"],
				toolAvailability: { bash: { enabled: true } },
			}),
		});

		const result = await wrapped.execute("id1", { command: "pnpm add playwright" });
		expect((result.details as any).error).toBe("install_blocked");
		expect((result.content[0] as { text: string }).text).toContain("blocked install command");
		expect(tool.execute).not.toHaveBeenCalled();
	});

	it("allows install commands in coding profile", async () => {
		const tool: AgentTool<any> = {
			name: "bash",
			label: "Bash",
			description: "Bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "executed" }],
				details: {},
			})),
		};

		const [wrapped] = wrapToolsWithWatchdog([tool], {
			runtimeProfile: "headless",
			preflight: createManifest({
				blockedInstallPackages: ["playwright"],
				toolAvailability: { bash: { enabled: true } },
			}),
		});

		const result = await wrapped.execute("id1", { command: "pnpm add playwright" });
		expect((result.content[0] as { text: string }).text).toBe("executed");
		expect(tool.execute).toHaveBeenCalledTimes(1);
	});

	it("returns no-output timeout result", async () => {
		vi.useFakeTimers();
		const tool: AgentTool<any> = {
			name: "bash",
			label: "Bash",
			description: "Bash",
			parameters: Type.Object({ command: Type.String() }),
			execute: vi.fn(
				async () =>
					new Promise<AgentToolResult<any>>((resolve) => {
						setTimeout(
							() =>
								resolve({
									content: [{ type: "text" as const, text: "late output" }],
									details: {},
								}),
							40_000,
						);
					}),
			),
		};

		const [wrapped] = wrapToolsWithWatchdog([tool], {
			runtimeProfile: "assistant",
			preflight: createManifest({
				toolAvailability: { bash: { enabled: true } },
			}),
		});

		const pending = wrapped.execute("id1", { command: "sleep 20" });
		await vi.advanceTimersByTimeAsync(41_000);
		const result = await pending;

		expect((result.details as any).error).toBe("timeout");
		expect((result.details as any).timeoutType).toBe("no_output");
	});

	it("gives gui tools a longer no-output window in assistant profile", async () => {
		vi.useFakeTimers();
		const tool: AgentTool<any> = {
			name: "gui_click",
			label: "GUI Click",
			description: "GUI Click",
			parameters: Type.Object({ target: Type.String() }),
			execute: vi.fn(
				async () =>
					new Promise<AgentToolResult<any>>((resolve) => {
						setTimeout(
							() =>
								resolve({
									content: [{ type: "text" as const, text: "clicked" }],
									details: {},
								}),
							20_000,
						);
					}),
			),
		};

		const [wrapped] = wrapToolsWithWatchdog([tool], {
			runtimeProfile: "assistant",
			preflight: createManifest({
				toolAvailability: { gui_click: { enabled: true } },
			}),
		});

		const pending = wrapped.execute("id1", { target: "Surge menu bar item" });
		await vi.advanceTimersByTimeAsync(21_000);
		const result = await pending;

		expect((result.content[0] as { text: string }).text).toBe("clicked");
		expect((result.details as any)?.error).toBeUndefined();
	});

	it("gives spawned-session tools longer no-output windows in assistant profile", async () => {
		vi.useFakeTimers();
		const tool: AgentTool<any> = {
			name: "sessions_spawn",
			label: "Spawn",
			description: "Spawn",
			parameters: Type.Object({ task: Type.String() }),
			execute: vi.fn(
				async () =>
					new Promise<AgentToolResult<any>>((resolve) => {
						setTimeout(
							() =>
								resolve({
									content: [{ type: "text" as const, text: "spawned child done" }],
									details: {},
								}),
							20_000,
						);
					}),
			),
		};

		const [wrapped] = wrapToolsWithWatchdog([tool], {
			runtimeProfile: "assistant",
			preflight: createManifest({
				toolAvailability: { sessions_spawn: { enabled: true } },
			}),
		});

		const pending = wrapped.execute("id1", { task: "search latest version" });
		await vi.advanceTimersByTimeAsync(21_000);
		const result = await pending;

		expect((result.content[0] as { text: string }).text).toBe("spawned child done");
		expect((result.details as any)?.error).toBeUndefined();
	});

	it("lets subagents wait honor the requested timeout window", async () => {
		vi.useFakeTimers();
		const tool: AgentTool<any> = {
			name: "subagents",
			label: "Subagents",
			description: "Wait for child sessions",
			parameters: Type.Object({
				action: Type.String(),
				timeoutMs: Type.Number(),
			}),
			execute: vi.fn(
				async () =>
					new Promise<AgentToolResult<any>>((resolve) => {
						setTimeout(
							() =>
								resolve({
									content: [{ type: "text" as const, text: "child completed" }],
									details: {},
								}),
							35_000,
						);
					}),
			),
		};

		const [wrapped] = wrapToolsWithWatchdog([tool], {
			runtimeProfile: "assistant",
			preflight: createManifest({
				toolAvailability: { subagents: { enabled: true } },
			}),
		});

		const pending = wrapped.execute("id1", { action: "wait", timeoutMs: 60_000 });
		await vi.advanceTimersByTimeAsync(36_000);
		const result = await pending;

		expect((result.content[0] as { text: string }).text).toBe("child completed");
		expect((result.details as any)?.error).toBeUndefined();
	});

	it("returns hard timeout when tool never resolves", async () => {
		vi.useFakeTimers();
		const tool: AgentTool<any> = {
			name: "web_search",
			label: "Search",
			description: "Search",
			parameters: Type.Object({ query: Type.String() }),
			execute: vi.fn(
				async (_toolCallId, _params, signal, onUpdate) =>
					new Promise<AgentToolResult<any>>(() => {
						const timer = setInterval(() => {
							onUpdate?.({
								content: [{ type: "text" as const, text: "tick" }],
								details: {},
							} as any);
						}, 5_000);
						signal?.addEventListener(
							"abort",
							() => {
								clearInterval(timer);
							},
							{ once: true },
						);
					}),
			),
		};

		const [wrapped] = wrapToolsWithWatchdog([tool], {
			runtimeProfile: "assistant",
			preflight: createManifest({
				toolAvailability: { web_search: { enabled: true } },
			}),
		});

		const pending = wrapped.execute("id1", { query: "test" });
		await vi.advanceTimersByTimeAsync(31_500);
		const result = await pending;

		expect((result.details as any).error).toBe("timeout");
		expect((result.details as any).timeoutType).toBe("hard");
	});

});
