import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMacosDemonstrationRecorder } from "../demonstration-recorder.js";

const cleanupDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
	const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
	await mkdir(dir, { recursive: true });
	cleanupDirs.push(dir);
	return dir;
}

function createFakeChild(onKill?: (signal?: NodeJS.Signals | number) => Promise<void> | void): any {
	const child = new EventEmitter() as EventEmitter & {
		stdout: PassThrough;
		stderr: PassThrough;
		pid: number;
		exitCode: number | null;
		killed: boolean;
		kill: ReturnType<typeof vi.fn>;
	};
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.pid = Math.floor(Math.random() * 10_000) + 1;
	child.exitCode = null;
	child.killed = false;
	child.kill = vi.fn((signal?: NodeJS.Signals | number) => {
		child.killed = true;
		void Promise.resolve(onKill?.(signal)).finally(() => {
			child.exitCode = 0;
			child.emit("exit", 0, typeof signal === "string" ? signal : null);
		});
		return true;
	});
	return child;
}

afterEach(async () => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (!dir) continue;
		await rm(dir, { recursive: true, force: true });
	}
});

describe("createMacosDemonstrationRecorder", () => {
	it("rejects recording on unsupported platforms", async () => {
		const recorder = createMacosDemonstrationRecorder({
			platform: "linux",
		});

		await expect(recorder.start({
			outputDir: "/tmp/understudy-demo-recorder-linux",
		})).rejects.toThrow("GUI demonstration recording is currently only supported on macOS.");
	});

	it("starts screencapture and event recorder processes and stops them into artifacts", async () => {
		const outputDir = await createTempDir("understudy-demo-recorder");
		const spawnCalls: Array<{ command: string; args: string[] }> = [];
		const fakeChildren: any[] = [];
		const spawnImpl = vi.fn((command: string, args: string[]) => {
			spawnCalls.push({ command, args });
			const child = createFakeChild(async () => {
				const outputPath = args[args.length - 1];
				if (command === "screencapture") {
					await writeFile(outputPath, "video");
					return;
				}
				const envPath = spawnImpl.mock.calls.at(-1)?.[2]?.env?.UNDERSTUDY_GUI_DEMO_EVENTS_PATH;
				if (typeof envPath === "string") {
					await writeFile(envPath, "[]");
				}
			});
			fakeChildren.push(child);
			return child;
		}) as any;

		const recorder = createMacosDemonstrationRecorder({
			spawnImpl,
			now: (() => {
				let value = 1_000;
				return () => (value += 500);
			})(),
			startupGraceMs: 0,
			stopTimeoutMs: 100,
			platform: "darwin",
		});
		const session = await recorder.start({
			outputDir,
			filePrefix: "demo",
			displayIndex: 2,
		});
		expect(session.status()).toMatchObject({
			state: "recording",
			displayIndex: 2,
		});

		const artifact = await session.stop();
		expect(artifact).toMatchObject({
			state: "stopped",
			displayIndex: 2,
		});
		await stat(artifact.videoPath);
		await stat(artifact.eventLogPath);
		expect(spawnCalls[0]).toMatchObject({
			command: "screencapture",
		});
		expect(spawnCalls[1]).toMatchObject({
			command: "swift",
		});
		expect(fakeChildren.every((child) => child.kill.mock.calls.length === 1)).toBe(true);
	});
});
