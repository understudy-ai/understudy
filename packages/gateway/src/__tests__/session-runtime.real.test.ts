import { afterAll, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createMacosDemonstrationRecorder } from "@understudy/gui";
import { createGatewaySessionRuntime, type SessionEntry } from "../session-runtime.js";

const shouldRunRealTeachTests =
	process.platform === "darwin" &&
	process.env.UNDERSTUDY_RUN_REAL_TEACH_TESTS === "1";
const execFileAsync = promisify(execFile);
const cleanupDirs: string[] = [];

function createEntry(id: string, overrides: Partial<SessionEntry> = {}): SessionEntry {
	const now = Date.now();
	return {
		id,
		createdAt: now,
		lastActiveAt: now,
		dayStamp: "2026-03-11",
		messageCount: 0,
		session: {},
		history: [],
		...overrides,
	};
}

async function wait(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanupApps(): Promise<void> {
	await execFileAsync("osascript", [
		"-e",
		'tell application "TextEdit" to quit saving no',
	]).catch(() => {});
	await execFileAsync("osascript", [
		"-e",
		'tell application "Finder" to close every Finder window',
	]).catch(() => {});
}

afterAll(async () => {
	await cleanupApps();
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (!dir) continue;
		await rm(dir, { recursive: true, force: true });
	}
});

describe.skipIf(!shouldRunRealTeachTests)("createGatewaySessionRuntime real teach smoke", () => {
	it("records a real teach demo through /teach start and /teach stop", async () => {
		const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;
		const tempHome = await mkdtemp(join(tmpdir(), "understudy-teach-real-home-"));
		const workspaceDir = join(tempHome, "workspace");
		cleanupDirs.push(tempHome);
		process.env.UNDERSTUDY_HOME = tempHome;

		try {
			const sessionEntries = new Map<string, SessionEntry>();
			const inFlightSessionIds = new Set<string>();
			const entry = createEntry("teach-real", {
				workspaceDir,
				repoRoot: tempHome,
			});
			const getOrCreateSession = vi.fn(async () => entry);
			const promptSession = vi.fn(async () => ({
				response: JSON.stringify({
					title: "Capture a reusable teach demo",
					objective: "Capture a reusable teach demo from the real desktop recording.",
					parameterSlots: [],
					successCriteria: ["The resulting skill can replay the demonstration safely."],
					openQuestions: [],
					steps: [
						{
							route: "gui",
							toolName: "gui_click",
							instruction: "Click the visible target from the recorded flow.",
							target: "Visible UI target",
						},
					],
					taskCard: {
						goal: "Capture a reusable teach demo from the real desktop recording.",
						scope: "The recorded Finder/TextEdit switching demo.",
						loopOver: "The active desktop flow.",
						inputs: [],
						extract: ["Observed desktop actions"],
						output: "A reusable teach draft.",
					},
					summary: "Teach clarification completed from the real recording.",
					nextQuestion: undefined,
					readyForConfirmation: true,
				}),
				runId: "run-teach-real-clarify",
			}));

			const runtime = createGatewaySessionRuntime({
				sessionEntries,
				inFlightSessionIds,
				config: {
					defaultModel: "gpt-5.4",
					defaultProvider: "openai-codex",
					agent: { userTimezone: "Asia/Hong_Kong" },
				} as any,
				usageTracker: { record: vi.fn() } as any,
				estimateTokens: (text) => text.length,
				appendHistory: vi.fn() as any,
				getOrCreateSession: getOrCreateSession as any,
				createScopedSession: vi.fn() as any,
				promptSession: promptSession as any,
				abortSessionEntry: vi.fn(async () => false),
				demonstrationRecorder: createMacosDemonstrationRecorder(),
			});

			const started = await runtime.chatHandler("/teach start", {
				channelId: "tui",
				senderId: "teach-real-user",
				cwd: workspaceDir,
			}) as Record<string, any>;
			expect(started.response).toContain("Started teach recording");

			await execFileAsync("open", ["-a", "Finder"]);
			await wait(500);
			await execFileAsync("open", ["-a", "TextEdit"]);
			await wait(1_000);

			const stopped = await runtime.chatHandler("/teach stop Capture the real smoke flow", {
				channelId: "tui",
				senderId: "teach-real-user",
				cwd: workspaceDir,
			}) as Record<string, any>;

			expect(stopped.response).toContain("entered teach clarification mode");
			expect(stopped.response).toContain("Recording:");
			expect(stopped.response).toMatch(/- Video: .+\.mov/);
			expect(stopped.response).toMatch(/- Event log: .+\.events\.json/);
			expect(stopped.meta?.teachClarification?.status).toBe("ready");
			expect(stopped.meta?.draft?.validation?.state).toBe("unvalidated");
		} finally {
			await cleanupApps();
			if (originalUnderstudyHome === undefined) {
				delete process.env.UNDERSTUDY_HOME;
			} else {
				process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
			}
		}
	}, 60_000);
});
