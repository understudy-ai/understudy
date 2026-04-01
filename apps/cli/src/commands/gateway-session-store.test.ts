import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveGatewaySessionState } from "./gateway-session-store.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("gateway session store", () => {
	it("does not persist recentRuns inside gateway state metadata", async () => {
		const tempDir = await createTempDir("understudy-gateway-session-store-");
		const storePath = join(tempDir, "state.json");

		await saveGatewaySessionState({
			storePath,
			sessionEntries: new Map([
				["session-1", {
					id: "session-1",
					createdAt: 1,
					lastActiveAt: 2,
					dayStamp: "2026-03-10",
					messageCount: 1,
					history: [],
					recentRuns: [{
						runId: "run-1",
						recordedAt: 2,
						userPromptPreview: "hi",
						responsePreview: "hello",
						toolTrace: [],
						attempts: [],
					}],
				} as any],
			]),
			agentRuns: new Map(),
			activeSessionBindings: new Map(),
		});

		const raw = JSON.parse(await readFile(storePath, "utf8")) as {
			sessions?: Array<Record<string, unknown>>;
		};
		expect(raw.sessions?.[0]).not.toHaveProperty("recentRuns");
		expect(raw.sessions?.[0]).not.toHaveProperty("history");
	});

	it("persists active session bindings alongside session metadata", async () => {
		const tempDir = await createTempDir("understudy-gateway-session-store-active-");
		const storePath = join(tempDir, "state.json");

		await saveGatewaySessionState({
			storePath,
			sessionEntries: new Map([
				["session-1", {
					id: "session-1",
					createdAt: 1,
					lastActiveAt: 2,
					dayStamp: "2026-03-10",
					messageCount: 1,
					history: [],
				} as any],
			]),
			agentRuns: new Map(),
			activeSessionBindings: new Map([
				["channel_sender:telegram:user-1", "session-1"],
			]),
		});

		const raw = JSON.parse(await readFile(storePath, "utf8")) as {
			activeSessionBindings?: Array<Record<string, unknown>>;
		};

		expect(raw.activeSessionBindings).toEqual([
			{
				routeKey: "channel_sender:telegram:user-1",
				sessionId: "session-1",
			},
		]);
	});

	it("omits bulky image payloads from persisted run snapshots", async () => {
		const tempDir = await createTempDir("understudy-gateway-session-store-runs-");
		const storePath = join(tempDir, "state.json");
		const giantBase64 = "a".repeat(200_000);
		const giantText = "b".repeat(20_000);

		await saveGatewaySessionState({
			storePath,
			sessionEntries: new Map(),
			agentRuns: new Map([
				["run-1", {
					runId: "run-1",
					threadId: "thread-1",
					status: "running",
					response: giantText,
					images: [
						{
							type: "image",
							mimeType: "image/png",
							data: giantBase64,
						},
					],
					meta: {
						latestToolResult: {
							images: [
								{
									type: "image",
									mimeType: "image/png",
									data: giantBase64,
								},
							],
							nested: {
								imageData: giantBase64,
								text: giantText,
							},
						},
					},
				} as any],
			]),
			activeSessionBindings: new Map(),
		});

			const raw = JSON.parse(await readFile(storePath, "utf8")) as {
				runs?: Array<Record<string, unknown>>;
			};
			const run = raw.runs?.[0];
			expect(run).toBeDefined();
			if (!run) {
				throw new Error("Expected a persisted run");
			}
			expect((run.response as string).length).toBeLessThan(17_000);
			expect(run.images).toEqual([
				{
					type: "image",
					mimeType: "image/png",
					data: "[image payload omitted]",
			},
		]);
		expect(run?.meta).toMatchObject({
			latestToolResult: {
				images: [
					{
						type: "image",
						mimeType: "image/png",
						note: "image payload omitted from persisted gateway state",
					},
				],
				nested: {
					imageData: "[image payload omitted]",
					},
				},
			});
			expect(((run.meta as any).latestToolResult.nested.text as string).length).toBeLessThan(17_000);
		});
	});
