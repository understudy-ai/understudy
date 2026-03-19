import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeToolset, listRuntimeToolCatalog } from "../runtime-toolset.js";
import { ScheduleService } from "../schedule/schedule-service.js";

const tempDirs: string[] = [];
const services: ScheduleService[] = [];

afterEach(async () => {
	for (const service of services.splice(0)) {
		service.stop();
	}
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createRuntimeToolset", () => {
	it("builds the shared baseline toolset without gateway-specific adapters", () => {
		const tools = createRuntimeToolset({
			cwd: "/tmp/workspace",
		});
		const names = tools.map((tool) => tool.name);

		expect(names).toEqual([
			"web_search",
			"web_fetch",
			"runtime_status",
			"process",
			"exec",
			"apply_patch",
			"image",
			"vision_read",
			"pdf",
			"browser",
		]);
	});

	it("adds gui, memory, messaging, schedule, gateway, and custom tools when configured", () => {
		const extraTool = {
			name: "custom_tool",
			parameters: {} as any,
			execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
		} as any;
		const tools = createRuntimeToolset({
			cwd: "/tmp/workspace",
			guiRuntime: {} as any,
			memoryProvider: {} as any,
			scheduleService: {} as any,
			getChannel: () => undefined,
			gatewayUrl: "http://127.0.0.1:23333",
			additionalTools: [extraTool],
		});
		const names = tools.map((tool) => tool.name);

		for (const expected of [
			"runtime_status",
			"gui_observe",
			"gui_click",
			"gui_drag",
			"gui_scroll",
			"gui_type",
			"gui_key",
			"gui_wait",
			"gui_move",
			"memory_search",
			"memory_get",
			"memory_manage",
			"message_send",
			"schedule",
			"cron",
			"sessions_list",
			"sessions_history",
			"session_status",
			"sessions_send",
			"agents_list",
			"gateway",
			"sessions_spawn",
			"subagents",
			"custom_tool",
		]) {
			expect(names).toContain(expected);
		}
	});

	it("exposes both schedule and the OpenClaw cron migration surface when only the gateway bridge is available", () => {
		const tools = createRuntimeToolset({
			cwd: "/tmp/workspace",
			gatewayUrl: "http://127.0.0.1:23333",
		});
		const names = tools.map((tool) => tool.name);

		expect(names).toContain("schedule");
		expect(names).toContain("cron");
	});

	it("passes the current channel session as the default schedule delivery target", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "understudy-runtime-toolset-schedule-"));
		tempDirs.push(tempDir);
		const scheduleService = new ScheduleService({
			storePath: join(tempDir, "jobs.json"),
			onJobTrigger: async () => {},
		});
		await scheduleService.start();
		services.push(scheduleService);

		const tools = createRuntimeToolset({
			cwd: "/tmp/workspace",
			scheduleService,
			channel: "telegram",
			senderId: "u123",
			threadId: "thread-9",
			requesterSessionId: "channel_sender:telegram:u123",
		});
		const scheduleTool = tools.find((tool) => tool.name === "schedule");

		expect(scheduleTool).toBeTruthy();
		await scheduleTool!.execute("id", {
			action: "create",
			name: "reminder",
			schedule: "0 9 * * *",
			command: "ping me",
		});

		expect(scheduleService.list({ includeDisabled: true })[0]?.delivery).toEqual({
			channelId: "telegram",
			senderId: "u123",
			sessionId: "channel_sender:telegram:u123",
			threadId: "thread-9",
		});
	});

	it("only exposes gui tools that the runtime reports as currently available", () => {
		const tools = createRuntimeToolset({
			cwd: "/tmp/workspace",
				guiRuntime: {
					describeCapabilities: () => ({
						platformSupported: true,
						groundingAvailable: false,
						nativeHelperAvailable: true,
						screenCaptureAvailable: true,
						inputAvailable: true,
						enabledToolNames: ["gui_observe", "gui_scroll", "gui_type", "gui_key", "gui_move"],
						disabledToolNames: ["gui_click", "gui_drag", "gui_wait"],
						toolAvailability: {
						gui_observe: { enabled: true, targetlessOnly: true },
						gui_click: { enabled: false, reason: "grounding unavailable" },
						gui_drag: { enabled: false, reason: "grounding unavailable" },
						gui_scroll: { enabled: true, targetlessOnly: true },
						gui_type: { enabled: true, targetlessOnly: true },
						gui_key: { enabled: true },
						gui_wait: { enabled: false, reason: "grounding unavailable" },
						gui_move: { enabled: true },
					},
				}),
			} as any,
		});
		const names = tools.map((tool) => tool.name);

		expect(names).toContain("gui_observe");
		expect(names).toContain("gui_scroll");
		expect(names).toContain("gui_type");
		expect(names).toContain("gui_key");
		expect(names).toContain("gui_move");
		expect(names).not.toContain("gui_click");
		expect(names).not.toContain("gui_drag");
		expect(names).not.toContain("gui_wait");
	});

	it("builds discovery metadata from the same runtime toolset", () => {
		const catalog = listRuntimeToolCatalog({
			cwd: "/tmp/workspace",
			guiRuntime: {} as any,
			memoryProvider: {} as any,
			scheduleService: {} as any,
			getChannel: () => undefined,
			gatewayUrl: "http://127.0.0.1:23333",
			additionalTools: [
				{
					name: "mcp_demo_lookup",
					label: "MCP demo.lookup",
					description: "Lookup something via MCP",
					parameters: {} as any,
					execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
				} as any,
				{
					name: "custom_tool",
					parameters: {} as any,
					execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
				} as any,
			],
		});
		const lookup = new Map(catalog.tools.map((tool) => [tool.name, tool]));

		expect(lookup.get("web_search")).toMatchObject({
			category: "web",
			surface: "runtime",
		});
		expect(lookup.get("runtime_status")).toMatchObject({
			category: "system",
			surface: "runtime",
		});
		expect(lookup.get("gui_click")).toMatchObject({
			category: "gui",
			surface: "runtime",
		});
		expect(lookup.get("sessions_send")).toMatchObject({
			category: "sessions",
			surface: "gateway",
		});
		expect(lookup.get("gateway")).toMatchObject({
			category: "gateway",
			surface: "gateway",
		});
		expect(lookup.get("mcp_demo_lookup")).toMatchObject({
			category: "mcp",
			surface: "mcp",
		});
		expect(lookup.get("custom_tool")).toMatchObject({
			category: "custom",
			surface: "custom",
		});
		expect(catalog.summary.total).toBe(catalog.tools.length);
		expect(catalog.summary.byCategory).toContainEqual({
			id: "gui",
			count: 8,
		});
		expect(catalog.summary.byCategory).toContainEqual({
			id: "system",
			count: 1,
		});
		expect(catalog.summary.bySurface).toContainEqual({
			id: "gateway",
			count: 8,
		});
	});

	it("appends plugin-provided tool factories after built-ins", () => {
		const tools = createRuntimeToolset({
			cwd: "/tmp/workspace",
			toolFactories: [
				(options) => ({
					name: `plugin_${options.cwd.split("/").at(-1)}`,
					label: "Plugin Tool",
					description: "Provided by plugin",
					parameters: {} as any,
					execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
				}) as any,
			],
		});
		const names = tools.map((tool) => tool.name);

		expect(names.at(-1)).toBe("plugin_workspace");
		expect(names).toContain("plugin_workspace");
	});

	it("exposes a platform capability discovery tool when platform surfaces are registered", async () => {
		const tools = createRuntimeToolset({
			cwd: "/tmp/workspace",
			platformCapabilities: [
				{
					id: "desktop_gui",
					label: "Desktop GUI",
					description: "Desktop observation and input control",
					source: "core",
					tags: ["gui", "desktop"],
				},
				{
					id: "plugin_canvas",
					label: "Plugin Canvas",
					description: "Canvas rendering provided by a plugin",
					source: "plugin",
					tags: ["canvas"],
				},
			],
		});
		const tool = tools.find((entry) => entry.name === "platform_capabilities");

		expect(tool).toBeTruthy();
		const textResult = await tool!.execute("tool", {});
		expect(JSON.stringify(textResult)).toContain("Desktop GUI");
		expect(JSON.stringify(textResult)).toContain("Plugin Canvas");

		const jsonResult = await tool!.execute("tool", { format: "json" });
		const jsonText = (jsonResult as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
		expect(jsonText).toContain("\"capabilities\"");
		expect(jsonText).toContain("\"plugin_canvas\"");
	});

	it("keeps platform capability discovery live when capabilities are provided via a getter", async () => {
		const dynamicCapabilities: Array<{
			id: string;
			label: string;
			description: string;
			source: "plugin";
			tags: string[];
		}> = [];
		const tools = createRuntimeToolset({
			cwd: "/tmp/workspace",
			platformCapabilities: () => dynamicCapabilities,
		});
		const tool = tools.find((entry) => entry.name === "platform_capabilities");

		expect(tool).toBeTruthy();

		const initialResult = await tool!.execute("tool", {});
		const initialText = (initialResult as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
		expect(initialText).toContain("No platform capabilities are currently registered.");

		dynamicCapabilities.push({
			id: "plugin_canvas",
			label: "Plugin Canvas",
			description: "Canvas rendering provided by a plugin",
			source: "plugin",
			tags: ["canvas"],
		});

		const jsonResult = await tool!.execute("tool", { format: "json" });
		const jsonText = (jsonResult as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? "";
		expect(jsonText).toContain("\"plugin_canvas\"");
		expect(jsonText).toContain("\"Plugin Canvas\"");
	});
});
