import { describe, expect, it } from "vitest";
import { GatewayRunRegistry, type AgentRunSnapshot } from "../run-registry.js";

describe("GatewayRunRegistry", () => {
	it("emits stream and tool events for a completed run", () => {
		const runs = new Map<string, AgentRunSnapshot>();
		const latestRunBySessionId = new Map<string, string>();
		const events: Array<{ type: string; data: Record<string, unknown> }> = [];
		const registry = new GatewayRunRegistry({
			runs,
			latestRunBySessionId,
			onEvent: (event) => {
				events.push({ type: event.type, data: event.data });
			},
		});

		registry.startRun({
			runId: "run_1",
			sessionId: "session_1",
			status: "in_flight",
			startedAt: 10,
			channelId: "web",
			senderId: "u1",
		});
		registry.emitToolEvent("session_1", {
			phase: "start",
			toolName: "bash",
			toolCallId: "tool_1",
			route: "shell",
			params: { command: "pwd" },
			startedAt: 20,
		});
		registry.emitToolEvent("session_1", {
			phase: "finish",
			toolName: "bash",
			toolCallId: "tool_1",
			route: "shell",
			params: { command: "pwd" },
			startedAt: 20,
			endedAt: 35,
			durationMs: 15,
			result: {
				route: "shell",
				isError: false,
				contentTypes: ["text"],
				textPreview: "/tmp",
			},
		});
		registry.completeRun({
			runId: "run_1",
			sessionId: "session_1",
			startedAt: 10,
			endedAt: 50,
			response: "done",
			meta: { durationMs: 40 },
		});

		expect(runs.get("run_1")).toMatchObject({
			runId: "run_1",
			sessionId: "session_1",
			status: "ok",
			response: "done",
			meta: { durationMs: 40 },
		});
		expect(latestRunBySessionId.get("session_1")).toBe("run_1");
		expect(events).toMatchObject([
			{
				type: "stream_start",
				data: {
					runId: "run_1",
					sessionId: "session_1",
					channelId: "web",
					senderId: "u1",
				},
			},
			{
				type: "tool_start",
				data: {
					runId: "run_1",
					sessionId: "session_1",
					toolCallId: "tool_1",
					toolName: "bash",
					summary: "Running a shell command.",
				},
			},
			{
				type: "tool_end",
				data: {
					runId: "run_1",
					sessionId: "session_1",
					toolCallId: "tool_1",
					toolName: "bash",
					status: "ok",
					summary: "Running a shell command.",
				},
			},
			{
				type: "stream_chunk",
				data: {
					runId: "run_1",
					sessionId: "session_1",
					text: "done",
					fullText: "done",
				},
			},
			{
				type: "stream_end",
				data: {
					runId: "run_1",
					sessionId: "session_1",
					status: "ok",
					text: "done",
					meta: { durationMs: 40 },
				},
			},
		]);
		expect(registry.getProgress("run_1")).toBeUndefined();
	});

	it("preserves image payloads on tool_end events for live WebChat cards", () => {
		const events: Array<{ type: string; data: Record<string, unknown> }> = [];
		const registry = new GatewayRunRegistry({
			runs: new Map(),
			latestRunBySessionId: new Map(),
			onEvent: (event) => {
				events.push({ type: event.type, data: event.data });
			},
		});

		registry.startRun({
			runId: "run_img",
			sessionId: "session_img",
			status: "in_flight",
			startedAt: 10,
		});
		registry.emitToolEvent("session_img", {
			phase: "finish",
			toolName: "gui_screenshot",
			toolCallId: "tool_img",
			route: "gui",
			params: {},
			startedAt: 12,
			endedAt: 25,
			durationMs: 13,
			result: {
				route: "gui",
				isError: false,
				contentTypes: ["text", "image"],
				textPreview: "Captured a GUI screenshot.",
				images: [
					{
						imageData: "ZmFrZS1pbWFnZQ==",
						mimeType: "image/png",
					},
				],
			},
		});

		expect(events).toContainEqual({
			type: "tool_end",
			data: {
				runId: "run_img",
				sessionId: "session_img",
				toolCallId: "tool_img",
				toolName: "gui_screenshot",
				route: "gui",
				status: "ok",
				summary: "Running screenshot.",
				startedAt: 12,
				endedAt: 25,
				durationMs: 13,
				result: {
					route: "gui",
					isError: false,
					contentTypes: ["text", "image"],
					textPreview: "Captured a GUI screenshot.",
					images: [
						{
							imageData: "ZmFrZS1pbWFnZQ==",
							mimeType: "image/png",
						},
					],
				},
			},
		});
		expect(registry.getProgress("run_img")).toMatchObject({
			latestToolResult: {
				toolCallId: "tool_img",
				toolName: "gui_screenshot",
				route: "gui",
				textPreview: "Captured a GUI screenshot.",
				images: [
					{
						type: "image",
						data: "ZmFrZS1pbWFnZQ==",
						mimeType: "image/png",
					},
				],
			},
		});
	});

	it("emits an error stream end for failed runs", () => {
		const events: Array<{ type: string; data: Record<string, unknown> }> = [];
		const registry = new GatewayRunRegistry({
			runs: new Map(),
			latestRunBySessionId: new Map(),
			onEvent: (event) => {
				events.push({ type: event.type, data: event.data });
			},
		});

		registry.startRun({
			runId: "run_2",
			sessionId: "session_2",
			status: "in_flight",
			startedAt: 5,
		});
		registry.errorRun({
			runId: "run_2",
			sessionId: "session_2",
			startedAt: 5,
			endedAt: 15,
			error: "boom",
		});

		expect(events).toMatchObject([
			{
				type: "stream_start",
				data: {
					runId: "run_2",
					sessionId: "session_2",
				},
			},
			{
				type: "stream_end",
				data: {
					runId: "run_2",
					sessionId: "session_2",
					status: "error",
					error: "boom",
				},
			},
		]);
	});

	it("forwards runtime status and thought chunks into gateway events and progress snapshots", () => {
		const events: Array<{ type: string; data: Record<string, unknown> }> = [];
		const registry = new GatewayRunRegistry({
			runs: new Map(),
			latestRunBySessionId: new Map(),
			onEvent: (event) => {
				events.push({ type: event.type, data: event.data });
			},
		});

		registry.startRun({
			runId: "run_3",
			sessionId: "session_3",
			status: "in_flight",
			startedAt: 5,
		});
		registry.emitRuntimeEvent("run_3", "session_3", {
			type: "status",
			text: "Planning the next GUI step",
		});
		registry.emitRuntimeEvent("run_3", "session_3", {
			type: "message_chunk",
			stream: "thought",
			text: "Need to inspect the login form first.",
		});

		expect(events).toContainEqual({
			type: "status_change",
			data: {
				runId: "run_3",
				sessionId: "session_3",
				scope: "run",
				text: "Planning the next GUI step",
				stage: "status",
			},
		});
		expect(events).toContainEqual({
			type: "stream_chunk",
			data: {
				runId: "run_3",
				sessionId: "session_3",
				stream: "thought",
				text: "Need to inspect the login form first.",
				fullText: "Need to inspect the login form first.",
			},
		});
		expect(registry.getProgress("run_3")).toMatchObject({
			summary: "Planning the next GUI step",
			stage: "status",
			steps: [
				expect.objectContaining({
					kind: "status",
					label: "Thinking through the task.",
				}),
				expect.objectContaining({
					kind: "status",
					label: "Planning the next GUI step",
					state: "running",
				}),
			],
		});
	});
});
