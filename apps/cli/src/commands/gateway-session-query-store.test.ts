import { describe, expect, it, vi } from "vitest";
import { FileGatewaySessionQueryStore } from "./gateway-session-query-store.js";

describe("FileGatewaySessionQueryStore", () => {
	it("builds session summaries from the dedicated run-trace store", async () => {
		const store = new FileGatewaySessionQueryStore(
			{
				getPath: () => "/tmp/state.json",
				load: async () => ({
					version: 2,
					savedAt: 1,
					sessions: [{
						id: "session-1",
						createdAt: 10,
						lastActiveAt: 20,
						dayStamp: "2026-03-10",
						messageCount: 2,
						history: [],
					}],
					runs: [],
				}),
				save: vi.fn(),
			},
			{
				getBaseDir: () => "/tmp/transcripts",
				append: vi.fn(),
				list: vi.fn(async () => []),
				remove: vi.fn(),
			},
			{
				getBaseDir: () => "/tmp/run-traces",
				append: vi.fn(),
				list: vi.fn(async () => [{
					runId: "run-1",
					recordedAt: 123,
					userPromptPreview: "hello",
					responsePreview: "done",
					toolTrace: [{ type: "toolResult", name: "gui_click", route: "gui" }],
					attempts: [],
				}]),
				remove: vi.fn(),
			},
		);

		const sessions = await store.listSessions();

		expect(sessions).toEqual([
			expect.objectContaining({
				id: "session-1",
				lastRunId: "run-1",
				lastRunAt: 123,
				lastToolName: "gui_click",
				lastToolRoute: "gui",
				lastToolStatus: "ok",
			}),
		]);
	});

	it("does not fall back to legacy recentRuns data in the metadata store", async () => {
		const store = new FileGatewaySessionQueryStore(
			{
				getPath: () => "/tmp/state.json",
				load: async () => ({
					version: 2,
					savedAt: 1,
					sessions: [{
						id: "session-legacy",
						createdAt: 10,
						lastActiveAt: 20,
						dayStamp: "2026-03-10",
						messageCount: 2,
						history: [],
						recentRuns: [{
							runId: "legacy-run",
							recordedAt: 456,
							userPromptPreview: "legacy",
							responsePreview: "legacy",
							toolTrace: [],
							attempts: [],
						}],
					} as any],
					runs: [],
				}),
				save: vi.fn(),
			},
			{
				getBaseDir: () => "/tmp/transcripts",
				append: vi.fn(),
				list: vi.fn(async () => []),
				remove: vi.fn(),
			},
			{
				getBaseDir: () => "/tmp/run-traces",
				append: vi.fn(),
				list: vi.fn(async () => []),
				remove: vi.fn(),
			},
		);

		expect(await store.listRunTraces({ sessionId: "session-legacy", limit: 10 })).toEqual([]);
	});
});
