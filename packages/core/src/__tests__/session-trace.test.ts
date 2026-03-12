import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionTraceLifecycleHooks } from "../session-trace.js";

const tempDirs: string[] = [];
const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;

function createTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0, tempDirs.length)) {
		rmSync(dir, { recursive: true, force: true });
	}
	if (originalUnderstudyHome === undefined) {
		delete process.env.UNDERSTUDY_HOME;
	} else {
		process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
	}
});

describe("createSessionTraceLifecycleHooks", () => {
	it("writes session and tool events to a JSONL trace file with truncation/redaction", async () => {
		const tracesDir = createTempDir("understudy-session-trace-");
		const understudyHome = createTempDir("understudy-home-");
		process.env.UNDERSTUDY_HOME = understudyHome;
		const trace = createSessionTraceLifecycleHooks({
			traceId: "test-session",
			tracesDir,
		});

		await trace.lifecycleHooks.onSessionCreated?.({
			sessionMeta: {
				backend: "embedded",
				model: "google/gemini-3-flash-preview",
				runtimeProfile: "assistant",
				workspaceDir: "/tmp/understudy",
				toolNames: ["gui_type"],
				promptReport: {
					systemPrompt: {
						chars: 1200,
						projectContextChars: 100,
					},
				},
			},
			promptReport: {
				systemPrompt: {
					chars: 1200,
					projectContextChars: 100,
				},
			},
		} as any);

		await trace.lifecycleHooks.onToolEvent?.({
			phase: "finish",
			toolName: "gui_type",
			toolCallId: "tool-1",
			route: "gui",
			startedAt: 100,
			endedAt: 180,
			durationMs: 80,
			params: {
				target: "Subject field",
				value: "A".repeat(400),
				apiKey: "secret-token",
			},
			result: {
				route: "gui",
				isError: false,
				contentTypes: ["text"],
				textPreview: "Typed into Subject field",
					details: {
						grounding_method: "grounding",
						confidence: 0.87,
						status: {
							code: "action_sent",
							summary: "Typed into Subject field",
						},
					},
			},
			sessionMeta: {
				backend: "embedded",
				model: "google/gemini-3-flash-preview",
				runtimeProfile: "assistant",
				workspaceDir: "/tmp/understudy",
				toolNames: ["gui_type"],
				promptReport: {} as any,
			},
		} as any);

		await trace.lifecycleHooks.onSessionClosed?.({
			sessionMeta: {
				backend: "embedded",
				model: "google/gemini-3-flash-preview",
				runtimeProfile: "assistant",
				workspaceDir: "/tmp/understudy",
				toolNames: ["gui_type"],
				promptReport: {} as any,
			},
		} as any);

		await trace.flush();

		const lines = readFileSync(trace.filePath, "utf-8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		expect(lines).toHaveLength(3);
		expect(lines[0]).toMatchObject({
			type: "session_created",
			traceId: "test-session",
			session: {
				backend: "embedded",
				systemPromptChars: 1200,
				projectContextChars: 100,
			},
		});
		expect(lines[1]).toMatchObject({
			type: "tool_event",
			traceId: "test-session",
			event: {
				phase: "finish",
				toolName: "gui_type",
				route: "gui",
				result: {
					details: {
						confidence: 0.87,
					},
				},
			},
		});
		expect(lines[1].event.params.target).toBe("Subject field");
		expect(lines[1].event.params.value.endsWith("...")).toBe(true);
		expect(lines[1].event.params.apiKey).toBe("[REDACTED:12]");
		expect(lines[2]).toMatchObject({
			type: "session_closed",
			traceId: "test-session",
		});
		const learningDir = join(understudyHome, "learning");
		expect(existsSync(learningDir)).toBe(false);
	});
});
