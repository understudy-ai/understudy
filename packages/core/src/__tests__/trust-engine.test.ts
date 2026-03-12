import { describe, it, expect, vi } from "vitest";
import { TrustEngine } from "../trust-engine.js";
import type { ToolEntry } from "@understudy/types";
import { Type } from "@sinclair/typebox";

function createMockEntry(name: string, riskLevel: ToolEntry["riskLevel"] = "read", category: ToolEntry["category"] = "filesystem"): ToolEntry {
	return {
		tool: {
			name,
			label: name,
			description: `Mock ${name}`,
			parameters: Type.Object({}),
			execute: async () => ({ content: [{ type: "text" as const, text: "executed" }], details: {} }),
		},
		riskLevel,
		category,
	};
}

describe("TrustEngine", () => {
	it("allows all tools with no policies", () => {
		const engine = new TrustEngine({ policies: [] });
		expect(engine.evaluate("anything")).toBe("allow");
	});

	it("denies tools matching deny policy", () => {
		const engine = new TrustEngine({
			policies: [{ match: ["dangerous_tool"], action: "deny" }],
		});
		expect(engine.evaluate("dangerous_tool")).toBe("deny");
		expect(engine.evaluate("safe_tool")).toBe("allow");
	});

	it("matches by category", () => {
		const engine = new TrustEngine({
			policies: [{ match: ["category:shell"], action: "require_approval" }],
		});
		const bashEntry = createMockEntry("bash", "execute", "shell");
		const readEntry = createMockEntry("read", "read", "filesystem");

		expect(engine.evaluate("bash", bashEntry)).toBe("require_approval");
		expect(engine.evaluate("read", readEntry)).toBe("allow");
	});

	it("matches by risk level", () => {
		const engine = new TrustEngine({
			policies: [{ match: ["risk:dangerous"], action: "deny" }],
		});
		const entry = createMockEntry("rm_rf", "dangerous", "shell");
		expect(engine.evaluate("rm_rf", entry)).toBe("deny");
	});

	it("wildcard matches all", () => {
		const engine = new TrustEngine({
			policies: [{ match: ["*"], action: "require_approval" }],
		});
		expect(engine.evaluate("anything")).toBe("require_approval");
	});

	it("supports case-insensitive tool patterns and tool: globs", () => {
		const engine = new TrustEngine({
			policies: [{ match: ["tool:GUI_*"], action: "deny" }],
		});
		expect(engine.evaluate("gui_click")).toBe("deny");
		expect(engine.evaluate("browser")).toBe("allow");
	});

	it("supports glob matching for category and risk patterns", () => {
		const engine = new TrustEngine({
			policies: [
				{ match: ["category:bro*", "risk:dan*"], action: "require_approval" },
			],
		});
		expect(engine.evaluate("browser", createMockEntry("browser", "read", "browser"))).toBe("require_approval");
		expect(engine.evaluate("bash", createMockEntry("bash", "dangerous", "shell"))).toBe("require_approval");
		expect(engine.evaluate("read", createMockEntry("read", "read", "filesystem"))).toBe("allow");
	});

	it("does not match category or risk wildcards when metadata is missing", () => {
		const engine = new TrustEngine({
			policies: [{ match: ["category:*", "risk:*"], action: "deny" }],
		});
		expect(engine.evaluate("bare-tool")).toBe("allow");
	});

	it("first match wins", () => {
		const engine = new TrustEngine({
			policies: [
				{ match: ["bash"], action: "allow" },
				{ match: ["*"], action: "deny" },
			],
		});
		expect(engine.evaluate("bash")).toBe("allow");
		expect(engine.evaluate("other")).toBe("deny");
	});

	it("auto-approves read-only tools by default", () => {
		const engine = new TrustEngine({ policies: [] });
		const readEntry = createMockEntry("read", "read", "filesystem");
		expect(engine.evaluate("read", readEntry)).toBe("allow");
	});

	it("rate limiting denies after exceeding limit", () => {
		const engine = new TrustEngine({
			policies: [{ match: ["search"], action: "allow", rateLimit: 2 }],
		});
		expect(engine.evaluate("search")).toBe("allow");
		expect(engine.evaluate("search")).toBe("allow");
		expect(engine.evaluate("search")).toBe("deny");
	});

	it("rate limiting groups tools by matched category policy", () => {
		const engine = new TrustEngine({
			policies: [{ match: ["category:shell"], action: "allow", rateLimit: 1 }],
		});
		expect(engine.evaluate("bash", createMockEntry("bash", "execute", "shell"))).toBe("allow");
		expect(engine.evaluate("zsh", createMockEntry("zsh", "execute", "shell"))).toBe("deny");
	});

	it("rate limiting groups tools by matched risk policy", () => {
		const engine = new TrustEngine({
			policies: [{ match: ["risk:dangerous"], action: "allow", rateLimit: 1 }],
		});
		expect(engine.evaluate("rm_rf", createMockEntry("rm_rf", "dangerous", "shell"))).toBe("allow");
		expect(engine.evaluate("network_reset", createMockEntry("network_reset", "dangerous", "browser"))).toBe("deny");
	});

	it("wrapTools creates wrapped tools that check policies", async () => {
		const engine = new TrustEngine({
			policies: [{ match: ["blocked"], action: "deny" }],
		});

		const entries = [
			createMockEntry("allowed", "read", "filesystem"),
			createMockEntry("blocked", "execute", "shell"),
		];

		const wrapped = engine.wrapTools(entries);
		expect(wrapped).toHaveLength(2);

		// Allowed tool executes normally
		const allowedResult = await wrapped[0].execute("id1", {});
		expect(allowedResult.content[0]).toEqual({ type: "text", text: "executed" });

		// Blocked tool returns denial
		const blockedResult = await wrapped[1].execute("id2", {});
		expect((blockedResult.content[0] as { type: "text"; text: string }).text).toContain("denied");
	});

	it("require_approval calls onApprovalRequired", async () => {
		const onApproval = vi.fn().mockResolvedValue(true);
		const engine = new TrustEngine({
			policies: [{ match: ["bash"], action: "require_approval" }],
			onApprovalRequired: onApproval,
		});

		const entries = [createMockEntry("bash", "execute", "shell")];
		const wrapped = engine.wrapTools(entries);
		await wrapped[0].execute("id1", { command: "pwd" });

		expect(onApproval).toHaveBeenCalledWith("bash", { command: "pwd" });
	});

	it("require_approval denies when approval handler is missing", async () => {
		const engine = new TrustEngine({
			policies: [{ match: ["bash"], action: "require_approval" }],
		});
		const entries = [createMockEntry("bash", "execute", "shell")];
		const wrapped = engine.wrapTools(entries);
		const result = await wrapped[0].execute("id1", { command: "pwd" });
		const text = (result.content[0] as { type: "text"; text: string }).text;
		expect(text).toContain("requires approval");
		expect((result.details as { denied?: boolean }).denied).toBe(true);
	});
});
