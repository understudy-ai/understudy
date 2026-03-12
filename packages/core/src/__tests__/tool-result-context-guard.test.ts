import { describe, expect, it } from "vitest";
import {
	CONTEXT_LIMIT_TRUNCATION_NOTICE,
	PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER,
	installToolResultContextGuard,
	recoverContextAfterOverflowInPlace,
} from "../runtime/tool-result-context-guard.js";

const PREEMPTIVE_CONVERSATION_COMPACTION_PLACEHOLDER =
	"[compacted: earlier conversation removed to free context]";

function toolResult(text: string) {
	return {
		role: "toolResult" as const,
		toolCallId: "tool_call_1",
		toolName: "bash",
		content: [{ type: "text" as const, text }],
		details: {},
		isError: false,
		timestamp: Date.now(),
	};
}

describe("installToolResultContextGuard", () => {
	it("truncates oversized tool results", async () => {
		const agent: any = {};
		installToolResultContextGuard({
			agent,
			contextWindowTokens: 200,
		});

		const messages = [toolResult("A".repeat(2_000))];
		const transformed = await agent.transformContext(messages, new AbortController().signal);
		const text = (transformed[0] as any).content[0].text as string;

		expect(
			text.includes(CONTEXT_LIMIT_TRUNCATION_NOTICE) ||
				text.includes(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER),
		).toBe(true);
	});

	it("compacts old tool results when context is still over budget", async () => {
		const agent: any = {};
		installToolResultContextGuard({
			agent,
			contextWindowTokens: 20,
		});

		const messages = [
			toolResult("A".repeat(800)),
			toolResult("B".repeat(800)),
			{
				role: "user" as const,
				content: "hello",
				timestamp: Date.now(),
			},
		];

		const transformed = await agent.transformContext(messages as any, new AbortController().signal);
		const contents = transformed
			.filter((msg: any) => msg.role === "toolResult")
			.map((msg: any) => msg.content[0]?.text ?? "");

		expect(contents.some((text: string) => text.includes(PREEMPTIVE_TOOL_RESULT_COMPACTION_PLACEHOLDER))).toBe(
			true,
		);
	});

	it("compacts older conversation turns when tool results are not the main cause", async () => {
		const agent: any = {};
		installToolResultContextGuard({
			agent,
			contextWindowTokens: 800,
		});

		const messages = Array.from({ length: 12 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content:
				index % 2 === 0
					? `user-${index}:${"U".repeat(240)}`
					: [{ type: "text" as const, text: `assistant-${index}:${"A".repeat(240)}` }],
			timestamp: Date.now() + index,
		}));

		const transformed = await agent.transformContext(messages as any, new AbortController().signal);
		const compacted = transformed
			.slice(0, 4)
			.map((msg: any) =>
				typeof msg.content === "string" ? msg.content : (msg.content?.[0]?.text ?? ""),
			);

		expect(compacted).toContain(PREEMPTIVE_CONVERSATION_COMPACTION_PLACEHOLDER);
		const latestText =
			typeof transformed.at(-1)?.content === "string"
				? transformed.at(-1)?.content
				: transformed.at(-1)?.content?.[0]?.text;
		expect(latestText).toContain("assistant-11");
	});

	it("prunes oldest compacted placeholders when the context is still over budget", async () => {
		const agent: any = {};
		installToolResultContextGuard({
			agent,
			contextWindowTokens: 600,
		});

		const messages = Array.from({ length: 20 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content:
				index % 2 === 0
					? `user-${index}:${"U".repeat(180)}`
					: [{ type: "text" as const, text: `assistant-${index}:${"A".repeat(180)}` }],
			timestamp: Date.now() + index,
		}));
		const originalLength = messages.length;

		const transformed = await agent.transformContext(messages as any, new AbortController().signal);
		expect(transformed.length).toBeLessThan(originalLength);
		expect(
			transformed.some((msg: any) => {
				const text =
					typeof msg.content === "string" ? msg.content : (msg.content?.[0]?.text ?? "");
				return text === PREEMPTIVE_CONVERSATION_COMPACTION_PLACEHOLDER;
			}),
		).toBe(true);
	});

	it("drops oldest context on overflow recovery retry when compaction is insufficient", () => {
		const messages = Array.from({ length: 18 }, (_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content:
				index % 2 === 0
					? `user-${index}:${"U".repeat(260)}`
					: [{ type: "text" as const, text: `assistant-${index}:${"A".repeat(260)}` }],
			timestamp: Date.now() + index,
		}));

		const recovery = recoverContextAfterOverflowInPlace({
			messages: messages as any,
			contextWindowTokens: 300,
		});

		expect(recovery.changed).toBe(true);
		expect(messages.length).toBeLessThan(18);
		const latestMessage = messages.at(-1) as any;
		const latestText =
			typeof latestMessage?.content === "string"
				? latestMessage.content
				: latestMessage?.content?.[0]?.text;
		expect(latestText).toContain("assistant-17");
	});

	it("restores original transformContext on uninstall", async () => {
		const original = async (messages: any[]) => messages.slice(1);
		const agent: any = {
			transformContext: original,
		};

		const uninstall = installToolResultContextGuard({
			agent,
			contextWindowTokens: 60,
		});
		expect(agent.transformContext).not.toBe(original);

		uninstall();
		expect(agent.transformContext).toBe(original);
	});
});
