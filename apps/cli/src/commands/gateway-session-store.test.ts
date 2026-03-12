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
		});

		const raw = JSON.parse(await readFile(storePath, "utf8")) as {
			sessions?: Array<Record<string, unknown>>;
		};
		expect(raw.sessions?.[0]).not.toHaveProperty("recentRuns");
		expect(raw.sessions?.[0]).not.toHaveProperty("history");
	});
});
