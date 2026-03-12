import { afterAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createMacosDemonstrationRecorder } from "../demonstration-recorder.js";

const shouldRunRealRecorderTests =
	process.platform === "darwin" &&
	process.env.UNDERSTUDY_RUN_REAL_GUI_TESTS === "1";
const execFileAsync = promisify(execFile);
const cleanupDirs: string[] = [];

async function cleanupTextEdit(): Promise<void> {
	await execFileAsync("osascript", [
		"-e",
		'tell application "TextEdit" to quit saving no',
	]).catch(() => {});
}

async function wait(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

afterAll(async () => {
	await cleanupTextEdit();
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (!dir) continue;
		await rm(dir, { recursive: true, force: true });
	}
});

describe.skipIf(!shouldRunRealRecorderTests)("createMacosDemonstrationRecorder real smoke", () => {
	it("captures a real demo video plus event timeline on macOS", async () => {
		const outputDir = await mkdtemp(join(tmpdir(), "understudy-demo-recorder-real-"));
		cleanupDirs.push(outputDir);
		const recorder = createMacosDemonstrationRecorder();

		const session = await recorder.start({
			outputDir,
			filePrefix: "real-demo-smoke",
			showClicks: true,
			maxDurationSec: 15,
		});

		await execFileAsync("open", ["-a", "Finder"]);
		await wait(500);
		await execFileAsync("open", ["-a", "TextEdit"]);
		await wait(900);

		const artifact = await session.stop();
		const [videoStat, eventLogStat, rawEvents] = await Promise.all([
			stat(artifact.videoPath),
			stat(artifact.eventLogPath),
			readFile(artifact.eventLogPath, "utf8"),
		]);
		const events = JSON.parse(rawEvents) as Array<Record<string, unknown>>;

		expect(artifact).toMatchObject({
			state: "stopped",
			videoPath: expect.stringContaining("real-demo-smoke"),
			eventLogPath: expect.stringContaining("real-demo-smoke"),
		});
		expect(artifact.durationMs).toBeGreaterThan(0);
		expect(videoStat.size).toBeGreaterThan(0);
		expect(eventLogStat.size).toBeGreaterThan(0);
		expect(Array.isArray(events)).toBe(true);
		expect(events.some((event) => event.type === "recording_started")).toBe(true);
		expect(events.some((event) => event.type === "recording_stopped")).toBe(true);
		expect(events.some((event) => event.type === "app_activated")).toBe(true);
	});
});
