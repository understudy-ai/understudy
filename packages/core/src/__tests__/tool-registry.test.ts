import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../tool-registry.js";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";

function createMockTool(name: string): AgentTool<any> {
	return {
		name,
		label: name,
		description: `Mock ${name} tool`,
		parameters: Type.Object({ input: Type.String() }),
		execute: async () => ({ content: [{ type: "text" as const, text: "ok" }], details: {} }),
	};
}

describe("ToolRegistry", () => {
	it("registers and retrieves tools", () => {
		const registry = new ToolRegistry();
		const tool = createMockTool("test_tool");
		registry.register(tool, { riskLevel: "read", category: "filesystem" });

		expect(registry.size).toBe(1);
		expect(registry.getToolNames()).toEqual(["test_tool"]);
		expect(registry.get("test_tool")?.tool.name).toBe("test_tool");
	});

	it("unregisters tools", () => {
		const registry = new ToolRegistry();
		registry.register(createMockTool("a"), { riskLevel: "read", category: "filesystem" });
		registry.register(createMockTool("b"), { riskLevel: "write", category: "filesystem" });

		expect(registry.size).toBe(2);
		registry.unregister("a");
		expect(registry.size).toBe(1);
		expect(registry.getToolNames()).toEqual(["b"]);
	});

	it("uses default risk/category when not specified", () => {
		const registry = new ToolRegistry();
		registry.register(createMockTool("custom"));

		const entry = registry.get("custom");
		expect(entry?.riskLevel).toBe("execute");
		expect(entry?.category).toBe("system");
	});

	it("assigns gui metadata for known gui tools", () => {
		const registry = new ToolRegistry();
		registry.register(createMockTool("gui_click"));

		const entry = registry.get("gui_click");
		expect(entry?.riskLevel).toBe("execute");
		expect(entry?.category).toBe("gui");
	});

	it("assigns Understudy metadata for built-in extension tools", () => {
		const registry = new ToolRegistry();
		registry.register(createMockTool("apply_patch"));
		registry.register(createMockTool("web_search"));
		registry.register(createMockTool("sessions_spawn"));

		expect(registry.get("apply_patch")).toMatchObject({
			riskLevel: "write",
			category: "filesystem",
		});
		expect(registry.get("web_search")).toMatchObject({
			riskLevel: "network",
			category: "web",
		});
		expect(registry.get("sessions_spawn")).toMatchObject({
			riskLevel: "dangerous",
			category: "system",
		});
	});

	it("getTools returns AgentTool array", () => {
		const registry = new ToolRegistry();
		registry.register(createMockTool("a"), { riskLevel: "read", category: "filesystem" });
		registry.register(createMockTool("b"), { riskLevel: "write", category: "filesystem" });

		const tools = registry.getTools();
		expect(tools).toHaveLength(2);
		expect(tools[0].name).toBe("a");
		expect(tools[1].name).toBe("b");
	});
});
