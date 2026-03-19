import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listChannelFactories } from "@understudy/channels";
import type { UnderstudyConfig } from "@understudy/types";
import { loadUnderstudyPlugins } from "../loader.js";
import { UnderstudyPluginRegistry } from "../registry.js";

function createConfig(plugins?: UnderstudyConfig["plugins"]): UnderstudyConfig {
	return {
		defaultProvider: "anthropic",
		defaultModel: "claude-sonnet-4-6",
		defaultThinkingLevel: "off",
		agent: {},
		channels: {},
		tools: {
			policies: [],
			autoApproveReadOnly: true,
		},
		memory: {
			enabled: false,
		},
		plugins,
	} as UnderstudyConfig;
}

describe("@understudy/plugins", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.splice(0).map(async (dir) => {
			await rm(dir, { recursive: true, force: true });
		}));
	});

	it("registers tool, gateway, CLI, and channel surfaces on the plugin registry", async () => {
		const registry = new UnderstudyPluginRegistry();
		const cliRegistrar = vi.fn();
		const gatewayHandler = vi.fn(async (params?: Record<string, unknown>) => ({
			echo: params?.value ?? "ok",
		}));
		const hookHandler = vi.fn();
		const serviceStart = vi.fn();
		const channelId = `plugin_test_${Date.now()}`;

		await registry.register({
			source: "demo-plugin",
			module: {
				id: "demo-plugin",
				register(api) {
					api.registerTool((options) => ({
						name: `plugin_tool_${options.cwd.split("/").at(-1)}`,
						description: "Plugin tool",
						parameters: {} as any,
						execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
					}) as any);
					api.registerGatewayMethod("plugin.echo", gatewayHandler);
					api.registerCli(cliRegistrar);
					api.registerHook("gateway_start", hookHandler);
					api.registerService({
						id: "demo-service",
						start: serviceStart,
					});
					api.registerPlatformCapability({
						id: "demo-platform",
						label: "Demo Platform",
						description: "Adds a platform-facing tool surface",
						toolFactories: [() => ({
							name: "platform_demo",
							description: "Platform demo tool",
							parameters: {} as any,
							execute: async () => ({ content: [{ type: "text", text: "platform" }] }),
						}) as any],
					});
					api.registerConfigSchema({
						jsonSchema: { type: "object", properties: { enabled: { type: "boolean" } } },
					});
					api.registerDiagnostic({
						level: "warn",
						message: "demo warning",
					});
					api.registerChannelFactory(channelId, () => ({
						warning: "plugin channel placeholder",
					}));
				},
			},
		});

		expect(registry.listPlugins()).toHaveLength(1);
		expect(registry.listPlugins()[0]).toMatchObject({
			id: "demo-plugin",
			source: "demo-plugin",
		});
		expect(registry.getGatewayMethods()).toHaveLength(1);
		expect(registry.getGatewayMethods()[0]?.[0]).toBe("plugin.echo");
		expect(await registry.getGatewayMethods()[0]?.[1]({ value: "pong" })).toEqual({
			echo: "pong",
		});
		expect(registry.getCliRegistrars()).toEqual([cliRegistrar]);
		expect(registry.getHooks("gateway_start")).toHaveLength(1);
		expect(registry.getHooks("gateway_start")[0]).toMatchObject({
			pluginId: "demo-plugin",
			hookName: "gateway_start",
		});
		expect(registry.getServices()).toHaveLength(1);
		expect(registry.getServices()[0]).toMatchObject({
			pluginId: "demo-plugin",
		});
		expect(registry.getPlatformCapabilities()).toContainEqual(expect.objectContaining({
			id: "demo-platform",
			source: "plugin",
		}));
		expect(registry.getConfigSchemas()).toHaveLength(1);
		expect(registry.getDiagnostics()).toContainEqual(expect.objectContaining({
			level: "warn",
			message: "demo warning",
			pluginId: "demo-plugin",
		}));
		expect(listChannelFactories()).toContain(channelId);

		const tool = registry.getToolFactories()[0]?.({
			cwd: "/tmp/workspace",
		} as any) as { name?: string } | undefined;
		expect(tool?.name).toBe("plugin_tool_workspace");
		const platformTool = registry.getToolFactories()[1]?.({
			cwd: "/tmp/workspace",
		} as any) as { name?: string } | undefined;
		expect(platformTool?.name).toBe("platform_demo");
	});

	it("loads plugin modules from config-relative paths", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "understudy-plugin-"));
		tempDirs.push(tempDir);
		const pluginPath = join(tempDir, "demo-plugin.mjs");
		await writeFile(
			pluginPath,
			[
				"export const id = 'loader-demo';",
				"export async function register(api) {",
				"  api.registerGatewayMethod('plugin.loaded', async (params = {}) => ({ loaded: params.value ?? true }));",
				"  api.registerTool(() => ({",
				"    name: 'plugin_loaded_tool',",
				"    description: 'Loaded from module',",
				"    parameters: {},",
				"    async execute() { return { content: [{ type: 'text', text: 'ok' }] }; }",
				"  }));",
				"}",
				"",
			].join("\n"),
			"utf8",
		);

		const registry = await loadUnderstudyPlugins({
			config: createConfig({
				modules: ["./demo-plugin.mjs"],
			}),
			configPath: join(tempDir, "config.json5"),
		});

		expect(registry.listPlugins()).toHaveLength(1);
		expect(registry.listPlugins()[0]).toMatchObject({
			id: "loader-demo",
			source: "./demo-plugin.mjs",
		});
		expect(registry.getToolFactories()[0]?.({ cwd: "/tmp" } as any)).toMatchObject({
			name: "plugin_loaded_tool",
		});
		expect(await registry.getGatewayMethods()[0]?.[1]({ value: "ok" })).toEqual({
			loaded: "ok",
		});
	});

	it("loads named register exports relative to cwd when configPath is absent", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "understudy-plugin-"));
		tempDirs.push(tempDir);
		const pluginPath = join(tempDir, "named-plugin.mjs");
		await writeFile(
			pluginPath,
			[
				"export const id = 'named-plugin';",
				"export async function register(api) {",
				"  api.registerGatewayMethod('plugin.named', async () => ({ ok: true }));",
				"}",
				"",
			].join("\n"),
			"utf8",
		);

		const registry = await loadUnderstudyPlugins({
			config: createConfig({
				modules: ["./named-plugin.mjs"],
			}),
			cwd: tempDir,
		});

		expect(registry.listPlugins()).toHaveLength(1);
		expect(registry.listPlugins()[0]).toMatchObject({
			id: "named-plugin",
			source: "./named-plugin.mjs",
		});
		expect(await registry.getGatewayMethods()[0]?.[1]()).toEqual({ ok: true });
	});

	it("throws a helpful error when a plugin module does not export a named register(api)", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "understudy-plugin-"));
		tempDirs.push(tempDir);
		const pluginPath = join(tempDir, "broken-plugin.mjs");
		await writeFile(
			pluginPath,
			"export default async function register() {}\n",
			"utf8",
		);

		await expect(loadUnderstudyPlugins({
			config: createConfig({
				modules: ["./broken-plugin.mjs"],
			}),
			configPath: join(tempDir, "config.json5"),
		})).rejects.toThrow('Plugin module "./broken-plugin.mjs" must export a named register(api) function.');
	});

	it("skips loading when plugins are disabled", async () => {
		const registry = await loadUnderstudyPlugins({
			config: createConfig({
				enabled: false,
				modules: ["./ignored.mjs"],
			}),
			configPath: "/tmp/config.json5",
		});

		expect(registry.listPlugins()).toHaveLength(0);
		expect(registry.getToolFactories()).toHaveLength(0);
		expect(registry.getGatewayMethods()).toHaveLength(0);
	});
});
