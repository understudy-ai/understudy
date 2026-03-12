#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const testHome = process.env.TEST_HOME?.trim() || await mkdtemp(join(tmpdir(), "understudy-basics-"));
const requestedPort = Number.parseInt(process.env.TEST_PORT ?? "18835", 10);
const lockRequestedPort = typeof process.env.TEST_PORT === "string" && process.env.TEST_PORT.trim().length > 0;
const defaultProvider = process.env.UNDERSTUDY_DEFAULT_PROVIDER?.trim() || "openai-codex";
const defaultModel = process.env.UNDERSTUDY_DEFAULT_MODEL?.trim() || "gpt-5.4";
const testPort = await resolveAvailablePort(requestedPort, { locked: lockRequestedPort });
const gatewayUrl = `http://127.0.0.1:${testPort}`;
const reportPath = join(testHome, "understudy-basics-report.md");
const gatewayLogPath = join(testHome, "gateway.log");
const caseLogsDir = join(testHome, "case-logs");
const p03ImageFixturePath = join(__dirname, "fixtures", "understudy-ocr.png");
const authSeedAgentDir =
	process.env.UNDERSTUDY_E2E_AUTH_SOURCE?.trim() || join(homedir(), ".understudy", "agent");
const results = [];

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function summarize(text, limit = 220) {
	const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
	return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`;
}

function normalizeTitle(value) {
	return String(value ?? "").trim().replace(/^#+\s*/, "");
}

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function canListenOnPort(port) {
	return await new Promise((resolvePromise) => {
		const server = createServer();
		server.once("error", () => resolvePromise(false));
		server.listen(port, "127.0.0.1", () => {
			server.close(() => resolvePromise(true));
		});
	});
}

async function resolveAvailablePort(port, options = {}) {
	if (await canListenOnPort(port)) {
		return port;
	}
	if (options.locked) {
		throw new Error(`Requested TEST_PORT ${port} is already in use.`);
	}
	for (let candidate = port + 1; candidate < port + 50; candidate += 1) {
		if (await canListenOnPort(candidate)) {
			return candidate;
		}
	}
	throw new Error(`Could not find an available port near ${port}.`);
}

async function waitForFile(path, timeoutMs = 120_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await exists(path)) {
			return;
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
	}
	throw new Error(`Timed out waiting for ${path}`);
}

async function seedAuthFiles(homeDir) {
	const targetAgentDir = join(homeDir, "agent");
	await mkdir(targetAgentDir, { recursive: true });
	for (const name of ["auth.json", "models.json"]) {
		const sourcePath = join(authSeedAgentDir, name);
		const targetPath = join(targetAgentDir, name);
		if (await exists(targetPath)) {
			continue;
		}
		if (!(await exists(sourcePath))) {
			continue;
		}
		await copyFile(sourcePath, targetPath);
	}
}

async function writeCaseLog(id, payload) {
	await writeFile(
		join(caseLogsDir, `${id}.json`),
		JSON.stringify(payload, null, 2),
		"utf8",
	);
}

async function rpc(method, params) {
	const response = await fetch(`${gatewayUrl}/rpc`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			id: `${method}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
			method,
			params,
		}),
	});
	const payload = await response.json();
	if (!response.ok || payload.error) {
		throw new Error(payload.error?.message || `RPC ${method} failed with HTTP ${response.status}`);
	}
	return payload.result;
}

async function waitForGateway() {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${gatewayUrl}/health`);
			if (response.ok) {
				return;
			}
		} catch {
			// Retry until the gateway is reachable.
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
	}
	throw new Error(`Gateway did not become ready at ${gatewayUrl}`);
}

async function runCase(id, title, fn) {
	const startedAt = Date.now();
	try {
		const outcome = await fn();
		const detail =
			outcome && typeof outcome === "object" && "detail" in outcome
				? outcome.detail
				: outcome;
		const log =
			outcome && typeof outcome === "object" && "log" in outcome
				? outcome.log
				: outcome;
		await writeCaseLog(id, {
			id,
			title,
			status: "pass",
			detail,
			log,
		});
		results.push({
			id,
			title,
			status: "pass",
			durationMs: Date.now() - startedAt,
			detail,
		});
	} catch (error) {
		await writeCaseLog(id, {
			id,
			title,
			status: "fail",
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		results.push({
			id,
			title,
			status: "fail",
			durationMs: Date.now() - startedAt,
			detail: error instanceof Error ? error.message : String(error),
		});
	}
}

const gatewayLog = [];
await mkdir(caseLogsDir, { recursive: true });
await seedAuthFiles(testHome);
const gateway = spawn(
	"node",
	["scripts/run-node.mjs", "gateway", "--port", String(testPort)],
	{
		cwd: repoRoot,
		env: {
			...process.env,
			UNDERSTUDY_HOME: testHome,
			UNDERSTUDY_GATEWAY_AUTH_MODE: "none",
			UNDERSTUDY_DEFAULT_PROVIDER: defaultProvider,
			UNDERSTUDY_DEFAULT_MODEL: defaultModel,
		},
		stdio: ["ignore", "pipe", "pipe"],
	},
);

gateway.stdout?.on("data", (chunk) => {
	gatewayLog.push(chunk.toString("utf8"));
});
gateway.stderr?.on("data", (chunk) => {
	gatewayLog.push(chunk.toString("utf8"));
});

let gatewayExitCode = null;
let gatewayExitSignal = null;
gateway.on("exit", (code, signal) => {
	gatewayExitCode = code;
	gatewayExitSignal = signal ?? null;
});

async function stopGateway() {
	if (gateway.exitCode !== null) {
		return;
	}
	gateway.kill("SIGTERM");
	const startedAt = Date.now();
	while (gateway.exitCode === null && Date.now() - startedAt < 5_000) {
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
	}
	if (gateway.exitCode === null) {
		gateway.kill("SIGKILL");
		const forcedAt = Date.now();
		while (gateway.exitCode === null && Date.now() - forcedAt < 2_000) {
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
		}
	}
}

try {
	await waitForGateway();

	await runCase("P-01", "Repo Q&A", async () => {
		const result = await rpc("chat.send", {
			text: "查看当前仓库顶层目录，并告诉我 README 的标题是什么。先自己检查，再回答，不要编造。",
			cwd: repoRoot,
		});
		assert(result.status === "ok", "chat.send did not return status=ok");
		assert(/Understudy/.test(result.response), `unexpected response: ${result.response}`);
		return {
			detail: summarize(result.response),
			log: result,
		};
	});

	await runCase("P-02", "Artifact Generation", async () => {
		const outputPath = join(testHome, "understudy-facts.md");
		const result = await rpc("chat.send", {
			text: `读取 README.md 和 package.json，生成 ${outputPath}。内容要求：1) 项目标题；2) 版本号；3) 5 条当前运行面能力摘要。完成后只回答生成的绝对路径。`,
			cwd: repoRoot,
		});
		assert(result.status === "ok", "artifact generation call failed");
		assert(result.response.trim() === outputPath, `unexpected output path: ${result.response}`);
		const fileText = await readFile(outputPath, "utf8");
		assert(fileText.includes("Understudy"), "generated facts file missing project title");
		assert(fileText.includes("0.1.0"), "generated facts file missing version");
		return {
			detail: summarize(fileText, 260),
			log: { result, outputPath, fileText },
		};
	});

	await runCase("P-03", "Multimodal File + Image", async () => {
		const attachmentPath = join(testHome, "understudy-file-test.txt");
		const imagePath = join(testHome, "understudy-ocr.png");
		await writeFile(attachmentPath, "Attachment marker: UNDERSTUDY-FILE-TEST-73\n", "utf8");
		await copyFile(p03ImageFixturePath, imagePath);
		const imageBytes = await readFile(imagePath);
		const result = await rpc("chat.send", {
			text: "同时读取我附带的文本文件和图片。输出严格格式：FILE=<文件中的marker>; IMAGE=<图片中的文字>",
			cwd: repoRoot,
			images: [{
				type: "image",
				data: imageBytes.toString("base64"),
				mimeType: "image/png",
			}],
			attachments: [{
				type: "file",
				url: attachmentPath,
				name: "understudy-file-test.txt",
				mimeType: "text/plain",
			}],
		});
		assert(result.status === "ok", "multimodal chat.send did not return ok");
		assert(
			result.response.trim() === "FILE=UNDERSTUDY-FILE-TEST-73; IMAGE=Understudy OCR 42",
			`unexpected multimodal output: ${result.response}`,
		);
		return {
			detail: result.response.trim(),
			log: { result, attachmentPath, imagePath },
		};
	});

	await runCase("P-04", "Session Follow-up Memory", async () => {
		const created = await rpc("session.create", {
			channelId: "web",
			senderId: "understudy-basics-user",
		});
		assert(created.id, "session.create did not return a session id");
		const first = await rpc("session.send", {
			sessionId: created.id,
			message: `读取 ${join(repoRoot, "README.md")} 的标题并记住它。只回复 READY。`,
		});
		assert(first.response.trim() === "READY", `unexpected first session reply: ${first.response}`);
		const second = await rpc("session.send", {
			sessionId: created.id,
			message: "刚才你记住的 README 标题是什么？只回答标题。",
		});
		assert(
			normalizeTitle(second.response) === "Understudy",
			`unexpected follow-up reply: ${second.response}`,
		);
		return {
			detail: `session=${created.id}`,
			log: { created, first, second },
		};
	});

	await runCase("P-05", "CI Diagnosis", async () => {
		const logPath = join(testHome, "understudy-ci-failure.log");
		await writeFile(logPath, [
			"Run pnpm test",
			"",
			"> app@0.1.0 test /workspace/app",
			"> vitest --run",
			"",
			" FAIL  src/user-service.test.ts > createUser > rejects duplicate email",
			"AssertionError: expected 201 to be 409",
			"",
			"- Expected",
			"+ Received",
			"",
			"- 409",
			"+ 201",
			"",
			"at src/user-service.test.ts:48:24",
		].join("\n"), "utf8");
		const result = await rpc("chat.send", {
			text: "你是值班工程师。读取我附带的 CI 失败日志，输出严格三行：ROOT_CAUSE=<一句话>; FILE=<文件路径和行号>; NEXT_ACTION=<一句话>",
			cwd: repoRoot,
			attachments: [{
				type: "file",
				url: logPath,
				name: "understudy-ci-failure.log",
				mimeType: "text/plain",
			}],
		});
		assert(result.status === "ok", "CI diagnosis chat.send did not return ok");
		assert(result.response.includes("ROOT_CAUSE="), "missing ROOT_CAUSE line");
		assert(result.response.includes("FILE=src/user-service.test.ts:48"), "missing file location");
		assert(result.response.includes("NEXT_ACTION="), "missing NEXT_ACTION line");
		return {
			detail: summarize(result.response, 260),
			log: { result, logPath },
		};
	});

	await runCase("P-06", "Schedule Automation", async () => {
		const outputPath = join(testHome, "understudy-schedule-output.md");
		const added = await rpc("schedule.add", {
			name: "write-readme-title",
			schedule: "0 9 * * *",
			command: `读取 ${join(repoRoot, "README.md")} 的标题，并写入 ${outputPath}。文件内容只保留标题本身。完成后结束。`,
		});
		assert(added.id, "schedule.add did not return a job id");
		const ran = await rpc("schedule.run", { id: added.id });
		assert(ran.ok === true, "schedule.run did not report ok=true");
		await waitForFile(outputPath);
		const fileText = (await readFile(outputPath, "utf8")).trim();
		assert(
			normalizeTitle(fileText) === "Understudy",
			`unexpected schedule output: ${fileText}`,
		);
		return {
			detail: `job=${added.id}`,
			log: { added, ran, outputPath, fileText },
		};
	});
} finally {
	await stopGateway();
	await writeFile(gatewayLogPath, gatewayLog.join(""), "utf8");
}

const report = [
	"# Understudy Basics E2E",
	"",
	`- Repo root: \`${repoRoot}\``,
	`- Test home: \`${testHome}\``,
	`- Gateway URL: \`${gatewayUrl}\``,
	`- Model: \`${defaultProvider}/${defaultModel}\``,
	`- Gateway exit: \`${gatewayExitCode ?? "still-running"}${gatewayExitSignal ? ` signal=${gatewayExitSignal}` : ""}\``,
	"",
	"| Case | Status | Duration (ms) | Detail | Raw log |",
	"|------|--------|---------------|--------|---------|",
	...results.map((entry) =>
		`| ${entry.id} ${entry.title} | ${entry.status.toUpperCase()} | ${entry.durationMs} | ${String(entry.detail).replace(/\|/g, "\\|")} | \`${join(caseLogsDir, `${entry.id}.json`)}\` |`
	),
	"",
	`Gateway log: \`${gatewayLogPath}\``,
].join("\n");

await writeFile(reportPath, report, "utf8");
console.log(report);

const failed = results.filter((entry) => entry.status !== "pass");
if (failed.length > 0) {
	process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
