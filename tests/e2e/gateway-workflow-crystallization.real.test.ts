import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams, execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import WebSocket from "ws";
import { loadPersistedWorkflowCrystallizationLedger } from "../../packages/core/src/workflow-crystallization.js";

const execFileAsync = promisify(execFile);
const repoRoot = process.env.UNDERSTUDY_REAL_WORKFLOW_CRYSTALLIZATION_REPO_ROOT
	?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const authPath = process.env.UNDERSTUDY_REAL_WORKFLOW_CRYSTALLIZATION_AUTH_PATH
	?? join(homedir(), ".understudy", "agent", "auth.json");
const shouldRunRealWorkflowCrystallizationTests =
	process.env.UNDERSTUDY_RUN_REAL_WORKFLOW_CRYSTALLIZATION_TESTS === "1" &&
	existsSync(authPath);

type RpcResult = {
	response: string;
	sessionId?: string;
	status?: string;
};

type WebWireMessage = {
	type?: string;
	id?: string;
	text?: string;
	error?: string;
	channelId?: string;
	threadId?: string;
};

async function getFreePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Could not allocate a TCP port"));
				return;
			}
			const { port } = address;
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(port);
			});
		});
		server.on("error", reject);
	});
}

async function waitForAssertion(assertion: () => void | Promise<void>, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			await assertion();
			return;
		} catch (error) {
			if (Date.now() >= deadline) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
	}
}

async function rpcCall<T>(baseUrl: string, method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(`${baseUrl}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: `${method}-${Math.random().toString(36).slice(2, 8)}`,
				method,
				params,
			}),
			signal: controller.signal,
		});
		expect(response.status).toBe(200);
		const payload = await response.json() as { error?: { message?: string }; result?: T };
		if (payload.error) {
			throw new Error(payload.error.message ?? `RPC ${method} failed`);
		}
		return payload.result as T;
	} finally {
		clearTimeout(timer);
	}
}

async function waitForGatewayHealth(baseUrl: string, timeoutMs: number, logs: { stdout: string[]; stderr: string[] }): Promise<void> {
	await waitForAssertion(async () => {
		const response = await fetch(`${baseUrl}/health`).catch(() => undefined);
		if (!response?.ok) {
			throw new Error([
				"Gateway health endpoint is not ready yet.",
				`stdout:\n${logs.stdout.slice(-20).join("")}`,
				`stderr:\n${logs.stderr.slice(-20).join("")}`,
			].join("\n\n"));
		}
	}, timeoutMs);
}

async function buildGatewayDist(): Promise<void> {
	const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
	await execFileAsync(pnpm, ["--dir", join(repoRoot, "packages/core"), "build"], {
		cwd: repoRoot,
		maxBuffer: 4 * 1024 * 1024,
	});
	await execFileAsync(pnpm, ["--dir", join(repoRoot, "packages/gateway"), "build"], {
		cwd: repoRoot,
		maxBuffer: 4 * 1024 * 1024,
	});
	await execFileAsync(pnpm, ["--dir", join(repoRoot, "apps/cli"), "build"], {
		cwd: repoRoot,
		maxBuffer: 4 * 1024 * 1024,
	});
}

function logStep(message: string): void {
	console.error(`[real-crystallization] ${message}`);
}

function makeCyclePrompt(cycle: number): string {
	switch (cycle) {
		case 1:
			return [
				"Create the cycle 1 ops status note.",
				"Save it as reports/ops/cycle-1.md with exactly two lines:",
				"cycle: 1",
				"status: green",
				"Then create reports/ops/cycle-1.done containing only reports/ops/cycle-1.md.",
			].join("\n");
		case 2:
			return [
				"Please file the cycle 2 green ops note in reports/ops/cycle-2.md.",
				"Use the same two-line markdown format:",
				"cycle: 2",
				"status: green",
				"Also write reports/ops/cycle-2.done with just the markdown path.",
			].join("\n");
		case 3:
			return [
				"Set up the next ops note for cycle 3.",
				"Put the note in reports/ops/cycle-3.md with exactly:",
				"cycle: 3",
				"status: green",
				"Leave a sibling marker file reports/ops/cycle-3.done whose full content is reports/ops/cycle-3.md.",
			].join("\n");
		case 4:
			return [
				"Create and file the cycle 4 ops note under reports/ops.",
				"The note file should be cycle-4.md and must contain exactly these two lines:",
				"cycle: 4",
				"status: green",
				"Then add cycle-4.done next to it with only reports/ops/cycle-4.md inside.",
			].join("\n");
		default:
			return [
				"Do the same ops filing workflow for cycle 5 in reports/ops.",
				"Use cycle-5.md for the note file with exactly:",
				"cycle: 5",
				"status: green",
				"Then create cycle-5.done containing only reports/ops/cycle-5.md.",
			].join("\n");
	}
}

async function expectCycleFiles(workspaceDir: string, cycle: number): Promise<void> {
	const notePath = join(workspaceDir, "reports", "ops", `cycle-${cycle}.md`);
	const donePath = join(workspaceDir, "reports", "ops", `cycle-${cycle}.done`);
	await waitForAssertion(async () => {
		const [noteText, doneText] = await Promise.all([
			readFile(notePath, "utf8"),
			readFile(donePath, "utf8"),
		]);
		expect(noteText.trim()).toBe(`cycle: ${cycle}\nstatus: green`);
		expect(doneText.trim()).toBe(`reports/ops/cycle-${cycle}.md`);
	}, 20_000);
}

describe.skipIf(!shouldRunRealWorkflowCrystallizationTests)("e2e: real gateway workflow crystallization", () => {
	let gatewayProcess: ChildProcessWithoutNullStreams | null = null;
	let webSocket: WebSocket | null = null;
	let tempHome: string | null = null;

	afterEach(async () => {
		if (webSocket && webSocket.readyState === WebSocket.OPEN) {
			webSocket.close();
		}
		webSocket = null;
		if (gatewayProcess && !gatewayProcess.killed) {
			gatewayProcess.kill("SIGTERM");
			await new Promise((resolve) => setTimeout(resolve, 1_000));
			if (!gatewayProcess.killed) {
				gatewayProcess.kill("SIGKILL");
			}
		}
		gatewayProcess = null;
		if (tempHome) {
			await rm(tempHome, { recursive: true, force: true });
			tempHome = null;
		}
	});

	it("runs a real-model workflow crystallization smoke through the CLI gateway", async () => {
		logStep("building core/gateway/cli dist");
		await buildGatewayDist();

		tempHome = await mkdtemp(join(tmpdir(), "understudy-real-crystallization-home-"));
		const workspaceDir = join(tempHome, "workspace");
		const configPath = join(tempHome, "config.json5");
		const agentDir = join(tempHome, "agent");
		const learningDir = join(tempHome, "learning");
		await mkdir(workspaceDir, { recursive: true });
		await mkdir(agentDir, { recursive: true });
		await cp(authPath, join(agentDir, "auth.json"));

		const gatewayPort = await getFreePort();
		const webPort = await getFreePort();
		await writeFile(configPath, JSON.stringify({
			defaultProvider: "openai-codex",
			defaultModel: "gpt-5.4",
			defaultThinkingLevel: "off",
			agent: {
				runtimeProfile: "assistant",
				runtimeBackend: "embedded",
				sandbox: {
					mode: "auto",
					dockerImage: "alpine:3.20",
					workspaceMountMode: "rw",
					disableNetwork: true,
				},
			},
			channels: {
				web: { enabled: true, settings: {} },
			},
			tools: {
				autoApproveReadOnly: true,
				policies: [],
			},
			memory: {
				enabled: false,
			},
			gateway: {
				port: gatewayPort,
				host: "127.0.0.1",
				enableWebSocket: true,
				sessionScope: "channel_sender",
				dmScope: "sender",
				idleResetMinutes: 0,
				dailyReset: true,
				channelAutoRestart: true,
				channelRestartBaseDelayMs: 2000,
				channelRestartMaxDelayMs: 30000,
			},
		}, null, 2), "utf8");

		const logs = {
			stdout: [] as string[],
			stderr: [] as string[],
		};
		gatewayProcess = spawn(process.execPath, [
			join(repoRoot, "apps/cli/dist/bin.js"),
			"gateway",
			"--port",
			String(gatewayPort),
			"--web-port",
			String(webPort),
			"--host",
			"127.0.0.1",
			"--config",
			configPath,
		], {
			cwd: repoRoot,
			env: {
				...process.env,
				UNDERSTUDY_HOME: tempHome,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		gatewayProcess.stdout.setEncoding("utf8");
		gatewayProcess.stderr.setEncoding("utf8");
		gatewayProcess.stdout.on("data", (chunk: string) => logs.stdout.push(chunk));
		gatewayProcess.stderr.on("data", (chunk: string) => logs.stderr.push(chunk));

		const baseUrl = `http://127.0.0.1:${gatewayPort}`;
		logStep(`waiting for gateway health at ${baseUrl}`);
		await waitForGatewayHealth(baseUrl, 30_000, logs);
		logStep("gateway health ready");

		const webMessages: WebWireMessage[] = [];
		webSocket = new WebSocket(`ws://127.0.0.1:${webPort}?clientId=workflow-live-user`);
		webSocket.on("message", (raw) => {
			try {
				webMessages.push(JSON.parse(String(raw)) as WebWireMessage);
			} catch {
				// Ignore malformed frames.
			}
		});
		await waitForAssertion(() => {
			expect(webMessages.some((message) => message.type === "ack" && message.id === "workflow-live-user")).toBe(true);
		}, 10_000);
		logStep("web client acknowledged");

		let primarySessionId: string | undefined;
		for (let cycle = 1; cycle <= 5; cycle += 1) {
			logStep(`running workflow cycle ${cycle}`);
			const result = await rpcCall<RpcResult>(baseUrl, "chat.send", {
				text: makeCyclePrompt(cycle),
				channelId: "web",
				senderId: "workflow-live-user",
				threadId: "workflow-thread",
				cwd: workspaceDir,
				waitForCompletion: true,
			}, 90_000);
			expect(result.status).toBe("ok");
			expect(result.response.length).toBeGreaterThan(0);
			if (!primarySessionId) {
				primarySessionId = result.sessionId;
			} else {
				expect(result.sessionId).toBe(primarySessionId);
			}
			await expectCycleFiles(workspaceDir, cycle);
			logStep(`cycle ${cycle} verified`);
		}

		logStep("waiting for crystallization ledger to publish a skill");
		await waitForAssertion(async () => {
			const ledger = await loadPersistedWorkflowCrystallizationLedger({
				workspaceDir,
				learningDir,
			});
			expect(ledger).toBeTruthy();
			expect((ledger?.days ?? []).reduce((count, day) => count + day.turns.length, 0)).toBeGreaterThanOrEqual(5);
			expect((ledger?.days ?? []).reduce((count, day) => count + day.segments.length, 0)).toBeGreaterThanOrEqual(3);
			expect((ledger?.days ?? []).reduce((count, day) => count + day.episodes.length, 0)).toBeGreaterThanOrEqual(3);
			expect(ledger?.clusters.length).toBeGreaterThanOrEqual(1);
			expect(ledger?.clusters.some((cluster) => cluster.completeCount >= 3)).toBe(true);
			expect(ledger?.skills.length).toBeGreaterThanOrEqual(1);
			expect(ledger?.skills[0]?.successfulEpisodeCount).toBeGreaterThanOrEqual(3);
			expect(ledger?.skills[0]?.publishedSkill?.skillPath).toBeTruthy();
		}, 180_000);
		logStep("skill published in ledger");

		logStep("waiting for user notification over web channel");
		await waitForAssertion(() => {
			expect(webMessages.some((message) =>
				message.type === "message"
				&& typeof message.text === "string"
				&& message.text.includes("Crystallized workflow skill ready"))).toBe(true);
		}, 60_000);
		logStep("notification observed");

		const finalLedger = await loadPersistedWorkflowCrystallizationLedger({
			workspaceDir,
			learningDir,
		});
		const skill = finalLedger?.skills[0];
		expect(skill).toBeTruthy();
		expect(skill?.publishedSkill?.skillPath).toBeTruthy();
		const skillMarkdown = await readFile(skill!.publishedSkill!.skillPath, "utf8");
		expect(skillMarkdown).toContain("## Observed Run States");
		expect(skillMarkdown).toContain("## Staged Workflow");
		expect(skillMarkdown).toContain("## Failure Policy");

		logStep("running natural-language reuse in a fresh session");
		const reuseResult = await rpcCall<RpcResult>(baseUrl, "chat.send", {
			text: "Please do the usual green ops note filing flow for cycle 99 in reports/ops, using the same two-line note format and the done marker.",
			channelId: "web",
			senderId: "workflow-live-user-fresh",
			threadId: "workflow-thread-fresh",
			cwd: workspaceDir,
			waitForCompletion: true,
		}, 90_000);
		expect(reuseResult.status).toBe("ok");
		expect(reuseResult.sessionId).toBeTruthy();
		expect(reuseResult.sessionId).not.toBe(primarySessionId);
		await expectCycleFiles(workspaceDir, 99);
		logStep("fresh-session reuse verified");
	}, 240_000);
});
