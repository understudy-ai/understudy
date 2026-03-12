import { describe, expect, it, vi } from "vitest";
import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
	buildToolExecutionResultSummary,
	resolveToolExecutionRoute,
	wrapToolsWithExecutionTrace,
} from "../runtime/tool-execution-trace.js";

describe("tool execution trace wrappers", () => {
	it("emits start and finish events for AgentTools", async () => {
		const onEvent = vi.fn();
		const tool: AgentTool<any> = {
			name: "gui_click",
			label: "GUI Click",
			description: "Click a semantic GUI target",
			parameters: Type.Object({ target: Type.String() }),
			execute: vi.fn(async () => ({
				content: [{ type: "text" as const, text: "Clicked Send button" }],
					details: {
						grounding_method: "grounding",
						confidence: 0.92,
						status: {
							code: "action_sent",
							summary: "Triggered Send button",
						},
					},
			})),
		};

		const [wrapped] = wrapToolsWithExecutionTrace([tool], {
			onEvent,
			getSessionMeta: () => ({
				backend: "embedded",
				model: "google/gemini-3-flash-preview",
				runtimeProfile: "assistant",
				workspaceDir: "/tmp/understudy",
				toolNames: ["gui_click"],
				promptReport: {} as any,
			}),
		});
		const result = await wrapped.execute("tool-call-1", { target: "Send button" });

		expect((result.content[0] as any).text).toContain("Clicked Send button");
		expect(onEvent).toHaveBeenCalledTimes(2);
		expect(onEvent.mock.calls[0][0]).toMatchObject({
			phase: "start",
			toolName: "gui_click",
			route: "gui",
			params: { target: "Send button" },
		});
		expect(onEvent.mock.calls[1][0]).toMatchObject({
			phase: "finish",
				toolName: "gui_click",
				route: "gui",
				result: {
					route: "gui",
					confidence: 0.92,
					groundingMethod: "grounding",
					status: {
						code: "action_sent",
						summary: "Triggered Send button",
					},
			},
		});
	});

	it("emits error events for AgentTools", async () => {
		const onEvent = vi.fn();
		const tool: AgentTool<any> = {
			name: "web_fetch",
			label: "Web Fetch",
			description: "Fetch a URL",
			parameters: Type.Object({ url: Type.String() }),
			execute: vi.fn(async () => {
				throw new Error("fetch unavailable");
			}),
		};

		const [wrapped] = wrapToolsWithExecutionTrace([tool], { onEvent });

		await expect(wrapped.execute("tool-call-2", { url: "https://example.com" }))
			.rejects
			.toThrow("fetch unavailable");

		expect(onEvent).toHaveBeenCalledTimes(2);
		expect(onEvent.mock.calls[1][0]).toMatchObject({
			phase: "error",
			toolName: "web_fetch",
			route: "web",
			error: "fetch unavailable",
		});
	});
});

describe("tool execution trace helpers", () => {
	it("classifies tool routes and summarizes results", () => {
			expect(resolveToolExecutionRoute("gui_type")).toBe("gui");
			expect(resolveToolExecutionRoute("browser")).toBe("browser");
			expect(resolveToolExecutionRoute("message_send")).toBe("messaging");
			expect(resolveToolExecutionRoute("custom_tool", { grounding_method: "grounding" })).toBe("gui");

			const summary = buildToolExecutionResultSummary("gui_wait", {
			content: [{ type: "text", text: "Wait condition satisfied" }],
				details: {
					grounding_method: "grounding",
					confidence: 0.8,
					status: {
						code: "condition_met",
						summary: "Target appeared.",
					},
				},
		} as any);

		expect(summary).toMatchObject({
			route: "gui",
			isError: false,
			textPreview: "Wait condition satisfied",
			confidence: 0.8,
			groundingMethod: "grounding",
				status: {
					code: "condition_met",
					summary: "Target appeared.",
				},
		});
	});

	it("preserves image payloads for renderable tool trace cards", () => {
		const summary = buildToolExecutionResultSummary("gui_screenshot", {
			content: [
				{ type: "text", text: "Captured a screenshot." },
				{ type: "image", data: "ZmFrZS1pbWFnZS1ieXRlcw==", mimeType: "image/png" },
			],
			details: {
				grounding_method: "screenshot",
			},
		} as any);

		expect(summary.images).toEqual([
			{
				imageData: "ZmFrZS1pbWFnZS1ieXRlcw==",
				mimeType: "image/png",
			},
		]);
	});
});
