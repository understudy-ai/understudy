import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "@understudy/types";
import { createRouteRetryGuardPolicy } from "../runtime/policies/route-guard-policy.js";

const context = {
	runtimeProfile: "assistant" as const,
	modelLabel: "google/gemini-3-flash-preview",
	cwd: "/tmp/understudy",
	config: DEFAULT_CONFIG,
};

describe("route retry guard policy", () => {
	it("surfaces session-level route guidance after repeated failures without hard-blocking retries", async () => {
		const policy = createRouteRetryGuardPolicy();

		const firstPrompt = await policy.beforePrompt?.(context, { text: "try the task" });
		expect(firstPrompt).toEqual({ text: "try the task" });

		for (const toolCallId of ["tool-1", "tool-2"]) {
			const pass = await policy.beforeTool?.(context, {
				toolName: "web_fetch",
				toolCallId,
				params: { url: "https://example.com" },
			});
			expect(pass?.result).toBeUndefined();

			policy.afterTool?.(context, {
				toolName: "web_fetch",
				toolCallId,
				params: { url: "https://example.com" },
					result: {
						content: [{ type: "text", text: "Web fetch failed: 401 unauthorized" }],
						details: {
							error: "401 unauthorized",
							status: {
								code: "blocked",
								summary: "401 unauthorized",
							},
						},
					} as any,
			});
		}

		const guardedPrompt = await policy.beforePrompt?.(context, { text: "try again" });
		expect(guardedPrompt?.text).toContain("[Understudy runtime route guard]");
		expect(guardedPrompt?.text).toContain("web");
		expect(guardedPrompt?.text).toContain("2 consecutive failure(s)");

		const passThrough = await policy.beforeTool?.(context, {
			toolName: "web_fetch",
			toolCallId: "tool-3",
			params: { url: "https://example.com" },
		});
		expect(passThrough?.result).toBeUndefined();
	});

	it("clears the guard after a successful result on that route", async () => {
		const policy = createRouteRetryGuardPolicy();

		for (const toolCallId of ["tool-1", "tool-2"]) {
			policy.afterTool?.(context, {
				toolName: "gui_click",
				toolCallId,
				params: { target: "Deploy" },
					result: {
						content: [{ type: "text", text: "Could not find Deploy button" }],
						details: {
							error: "No confident clickable target was found.",
							status: {
								code: "not_found",
								summary: "No confident clickable target was found.",
							},
						},
					} as any,
			});
		}

		expect((await policy.beforePrompt?.(context, { text: "retry deploy" }))?.text).toContain("gui");

		policy.afterTool?.(context, {
			toolName: "gui_click",
			toolCallId: "tool-3",
			params: { target: "Deploy" },
				result: {
					content: [{ type: "text", text: "Clicked Deploy button" }],
					details: {
						status: {
							code: "action_sent",
							summary: "Deploy clicked.",
						},
						confidence: 0.91,
						grounding_method: "grounding",
					},
				} as any,
		});

		expect(await policy.beforePrompt?.(context, { text: "continue" })).toEqual({ text: "continue" });
	});

	it("tracks browser and gui failures independently", async () => {
		const policy = createRouteRetryGuardPolicy();

		for (const toolCallId of ["browser-1", "browser-2"]) {
			policy.afterTool?.(context, {
				toolName: "browser",
				toolCallId,
				params: { action: "click", selector: "button[type=submit]" },
					result: {
						content: [{ type: "text", text: "Browser error: target missing" }],
						details: {
							error: "Browser target missing",
							status: {
								code: "not_found",
								summary: "Browser target missing",
							},
						},
					} as any,
			});
		}

		const browserPass = await policy.beforeTool?.(context, {
			toolName: "browser",
			toolCallId: "browser-3",
			params: { action: "click", selector: "button[type=submit]" },
		});
		expect(browserPass?.result).toBeUndefined();

		const guiPass = await policy.beforeTool?.(context, {
			toolName: "gui_click",
			toolCallId: "gui-1",
			params: { target: "Save" },
		});
		expect(guiPass?.result).toBeUndefined();
	});
});
