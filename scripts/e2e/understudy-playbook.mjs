#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const packageJsonPath = join(repoRoot, "package.json");
const packageVersion = JSON.parse(await readFile(packageJsonPath, "utf8")).version?.trim() || "unknown";
const testHome = process.env.TEST_HOME?.trim() || await mkdtemp(join(tmpdir(), "understudy-playbook-e2e-"));
const requestedWorkspaceDir = process.env.PLAYBOOK_WORKSPACE_DIR?.trim();
const usingDefaultExampleWorkspace = !requestedWorkspaceDir;
const workspaceDir = requestedWorkspaceDir || join(testHome, "workspace");
const requestedPort = Number.parseInt(process.env.TEST_PORT ?? "18836", 10);
const lockRequestedPort = typeof process.env.TEST_PORT === "string" && process.env.TEST_PORT.trim().length > 0;
const defaultProvider = process.env.UNDERSTUDY_DEFAULT_PROVIDER?.trim() || "openai-codex";
const defaultModel = process.env.UNDERSTUDY_DEFAULT_MODEL?.trim() || "gpt-5.4";
const requestedMode = process.env.PLAYBOOK_E2E_MODE?.trim().toLowerCase();
const legacySyntheticFlag = process.env.PLAYBOOK_E2E_SYNTHETIC?.trim();
const playbookName = process.env.PLAYBOOK_NAME?.trim() || "target-brief-studio";
const targetName = process.env.PLAYBOOK_TARGET_NAME?.trim() || "GitHub";
const analysisFocus = process.env.PLAYBOOK_ANALYSIS_FOCUS?.trim() || "First-pass product overview";
const rawPlaybookInputsJson = process.env.PLAYBOOK_INPUTS_JSON?.trim();
const playbookEnvFile = process.env.PLAYBOOK_ENV_FILE?.trim() || process.env.UNDERSTUDY_ENV_FILE?.trim();
const requestedAdvanceOnOutputs = process.env.PLAYBOOK_E2E_ADVANCE_ON_OUTPUTS?.trim();
const requestedAbortOnOutputReady = process.env.PLAYBOOK_E2E_ABORT_ON_OUTPUT_READY?.trim();
const traceChildSession = process.env.PLAYBOOK_E2E_TRACE_CHILD === "1";
const requestedGlobalBrowserRelayReuse = readOptionalBooleanEnv("PLAYBOOK_E2E_REUSE_GLOBAL_BROWSER");
const demoSelectionMode = process.env.PLAYBOOK_SELECTION_MODE?.trim() || "fixed_target_app_metadata";
const demoTargetApp = process.env.PLAYBOOK_TARGET_APP?.trim() || "Snapseed";
const demoTargetAppStoreUrl = process.env.PLAYBOOK_TARGET_APP_STORE_URL?.trim()
	|| "https://apps.apple.com/us/app/snapseed-photo-editor/id439438619";
const demoAppStoreRegion = process.env.PLAYBOOK_APP_STORE_REGION?.trim() || "us";
const demoPublishNow = readOptionalBooleanEnv("PLAYBOOK_PUBLISH_NOW") ?? true;
const demoPublishVisibility = process.env.PLAYBOOK_PUBLISH_VISIBILITY?.trim() || "unlisted";
const reportPath = join(testHome, "understudy-playbook-report.md");
const reportJsonPath = join(testHome, "understudy-playbook-report.json");
const gatewayLogPath = join(testHome, "gateway.log");
const authSeedAgentDir =
	process.env.UNDERSTUDY_E2E_AUTH_SOURCE?.trim() || join(homedir(), ".understudy", "agent");
const testPort = await resolveAvailablePort(requestedPort, { locked: lockRequestedPort });
const browserRelayPort = testPort + 3;
const browserRelayUrl = `http://127.0.0.1:${browserRelayPort}`;
const gatewayUrl = `http://127.0.0.1:${testPort}`;
const gatewayLog = [];
const stageReports = [];

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO8B5o8AAAAASUVORK5CYII=";

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function readPositiveIntegerEnv(name, fallback) {
	const raw = process.env[name]?.trim();
	if (!raw) {
		return fallback;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer, received ${JSON.stringify(raw)}`);
	}
	return parsed;
}

function readOptionalPositiveIntegerEnv(name) {
	const raw = process.env[name]?.trim();
	if (!raw) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer when provided, received ${JSON.stringify(raw)}`);
	}
	return parsed;
}

function defaultPlaybookInputs() {
	if (playbookName === "app-review-pipeline") {
		return {
			selectionMode: demoSelectionMode,
			targetApp: demoTargetApp,
			targetAppStoreUrl: demoTargetAppStoreUrl,
			appStoreRegion: demoAppStoreRegion,
			publishNow: demoPublishNow,
			publishVisibility: demoPublishVisibility,
		};
	}
	return {
		targetName,
		analysisFocus,
	};
}

function parsePlaybookInputs() {
	const defaults = defaultPlaybookInputs();
	if (!rawPlaybookInputsJson) {
		return defaults;
	}
	let parsed;
	try {
		parsed = JSON.parse(rawPlaybookInputsJson);
	} catch (error) {
		throw new Error(`PLAYBOOK_INPUTS_JSON must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("PLAYBOOK_INPUTS_JSON must decode to a JSON object.");
	}
	return {
		...defaults,
		...parsed,
	};
}

function resolveSyntheticMode() {
	if (requestedMode === "synthetic") {
		return true;
	}
	if (requestedMode === "live") {
		return false;
	}
	if (legacySyntheticFlag === "1") {
		return true;
	}
	if (legacySyntheticFlag === "0") {
		return false;
	}
	return true;
}

async function exists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function resolveExampleWorkspaceSource() {
	const candidates = [
		join(repoRoot, "examples", "handwritten-playbook-demo"),
		join(repoRoot, "packages", "gateway", "src", "__tests__", "fixtures", "handwritten-playbook-demo"),
	];
	for (const candidate of candidates) {
		if (await exists(candidate)) {
			return candidate;
		}
	}
	throw new Error(
		`Could not find the handwritten playbook demo workspace. Checked: ${candidates.map((entry) => JSON.stringify(entry)).join(", ")}`,
	);
}

function summarize(text, limit = 240) {
	const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
	return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 3)}...`;
}

function stageOutputToPath(outputPath) {
	if (outputPath === "approval.state") {
		return null;
	}
	if (outputPath.endsWith("/*")) {
		return `${outputPath.slice(0, -2)}/placeholder.txt`;
	}
	return outputPath;
}

function stageOutputAlternatives(outputPath) {
	return String(outputPath ?? "")
		.split(/\?\?|\|\|/)
		.map((entry) => stageOutputToPath(entry.trim()))
		.filter(Boolean);
}

function sanitizeFilePart(value) {
	return String(value ?? "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "") || "snapshot";
}

function readBooleanEnv(name) {
	const raw = process.env[name]?.trim().toLowerCase();
	if (!raw) {
		return false;
	}
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readOptionalBooleanEnv(name) {
	const raw = process.env[name]?.trim().toLowerCase();
	if (!raw) {
		return undefined;
	}
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function asTrimmedString(value) {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : "";
}

function parseLoopbackPort(rawUrl) {
	try {
		const parsed = new URL(rawUrl);
		const port =
			parsed.port.trim() !== ""
				? Number(parsed.port)
				: parsed.protocol === "https:"
					? 443
					: 80;
		if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
			return null;
		}
		const host = parsed.hostname.trim().toLowerCase();
		if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
			return null;
		}
		return port;
	} catch {
		return null;
	}
}

async function loadJson5File(path) {
	try {
		return JSON5.parse(await readFile(path, "utf8"));
	} catch {
		return null;
	}
}

async function resolveReusableBrowserRelayConfig() {
	const explicitCdpUrl = asTrimmedString(process.env.PLAYBOOK_E2E_BROWSER_CDP_URL);
	if (!reuseGlobalBrowserRelay && !explicitCdpUrl) {
		return null;
	}

	if (explicitCdpUrl) {
		return {
			source: "explicit PLAYBOOK_E2E_BROWSER_CDP_URL",
			cdpUrl: explicitCdpUrl,
			authMode: asTrimmedString(process.env.PLAYBOOK_E2E_BROWSER_RELAY_AUTH_MODE) || "none",
			gatewayToken: asTrimmedString(process.env.PLAYBOOK_E2E_BROWSER_RELAY_GATEWAY_TOKEN) || "",
		};
	}

	const browserHome = asTrimmedString(process.env.PLAYBOOK_E2E_BROWSER_HOME)
		|| asTrimmedString(process.env.UNDERSTUDY_HOME)
		|| join(homedir(), ".understudy");
	const configPath = join(browserHome, "config.json5");
	const config = await loadJson5File(configPath);
	const cdpUrl = asTrimmedString(config?.browser?.cdpUrl);
	if (!cdpUrl) {
		throw new Error(
			`PLAYBOOK_E2E_REUSE_GLOBAL_BROWSER=1 was requested, but no browser.cdpUrl was found in ${configPath}.`,
		);
	}
	if (!parseLoopbackPort(cdpUrl)) {
		throw new Error(
			`PLAYBOOK_E2E_REUSE_GLOBAL_BROWSER=1 requires a loopback browser.cdpUrl, received ${JSON.stringify(cdpUrl)} from ${configPath}.`,
		);
	}
	return {
		source: configPath,
		cdpUrl,
		authMode: asTrimmedString(config?.gateway?.auth?.mode)?.toLowerCase() || "none",
		gatewayToken: asTrimmedString(config?.gateway?.auth?.token),
	};
}

const syntheticMode = resolveSyntheticMode();
const e2eMode = syntheticMode ? "synthetic" : "live";
const reuseGlobalBrowserRelay = requestedGlobalBrowserRelayReuse ?? !syntheticMode;
const advanceOnOutputs = requestedAdvanceOnOutputs
	? requestedAdvanceOnOutputs !== "0"
	: syntheticMode;
const abortOnOutputReady = requestedAbortOnOutputReady
	? requestedAbortOnOutputReady !== "0"
	: syntheticMode;
const gatewayReadyTimeoutMs = readPositiveIntegerEnv("PLAYBOOK_E2E_GATEWAY_TIMEOUT_MS", 90_000);
const agentWaitTimeoutMs = readPositiveIntegerEnv("PLAYBOOK_E2E_AGENT_WAIT_TIMEOUT_MS", 10_000);
const liveStageTimeoutMs = readPositiveIntegerEnv("PLAYBOOK_E2E_LIVE_STAGE_TIMEOUT_MS", 1_800_000);
const traceChildPollInterval = readPositiveIntegerEnv("PLAYBOOK_E2E_TRACE_POLL_INTERVAL", 3);
const traceHistoryLimit = readPositiveIntegerEnv("PLAYBOOK_E2E_TRACE_HISTORY_LIMIT", 12);
const traceRunLimit = readPositiveIntegerEnv("PLAYBOOK_E2E_TRACE_RUN_LIMIT", 6);
const stopAfterStageCount = readOptionalPositiveIntegerEnv("PLAYBOOK_E2E_STOP_AFTER_STAGE_COUNT");
const playbookInputs = parsePlaybookInputs();
const reusableBrowserRelay = await resolveReusableBrowserRelayConfig();
const exampleWorkspaceSource = usingDefaultExampleWorkspace ? await resolveExampleWorkspaceSource() : null;
const scenarioLabel = usingDefaultExampleWorkspace
	? "generic handwritten playbook example"
	: "custom workspace playbook";
const liveGuiExpectation = usingDefaultExampleWorkspace
	? "This harness does not open iPhone Mirroring or other real GUI apps."
	: syntheticMode
		? "Synthetic mode does not open real GUI apps."
		: "Real GUI behavior depends on the supplied workspace and playbook.";

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

async function ensureWorkspace() {
	if (requestedWorkspaceDir) {
		assert(await exists(requestedWorkspaceDir), `PLAYBOOK_WORKSPACE_DIR does not exist: ${requestedWorkspaceDir}`);
		return;
	}
	await mkdir(testHome, { recursive: true });
	assert(exampleWorkspaceSource, "Expected an example workspace source for the default playbook harness.");
	await cp(exampleWorkspaceSource, workspaceDir, { recursive: true });
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
	const deadline = Date.now() + gatewayReadyTimeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${gatewayUrl}/health`);
			if (response.ok) {
				return;
			}
		} catch {
			// Retry until reachable.
		}
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
	}
	throw new Error(`Gateway did not become ready at ${gatewayUrl} within ${gatewayReadyTimeoutMs}ms.`);
}

async function areStageArtifactsReady(rootDir, stage) {
	for (const output of Array.isArray(stage.outputs) ? stage.outputs : []) {
		const alternatives = stageOutputAlternatives(output);
		if (alternatives.length === 0) {
			continue;
		}
		let matched = false;
		for (const artifactPath of alternatives) {
			if (await exists(join(rootDir, artifactPath))) {
				matched = true;
				break;
			}
		}
		if (!matched) {
			return false;
		}
	}
	return Array.isArray(stage.outputs) && stage.outputs.length > 0;
}

async function listObservedStageArtifacts(rootDir, stage) {
	const observed = [];
	for (const output of Array.isArray(stage.outputs) ? stage.outputs : []) {
		for (const artifactPath of stageOutputAlternatives(output)) {
			if (await exists(join(rootDir, artifactPath))) {
				observed.push(artifactPath);
				break;
			}
		}
	}
	return observed;
}

function getStageSummaryPath(rootDir, stage) {
	return join(rootDir, "stage-summaries", `${stage.id}.md`);
}

async function readStageSummaryState(rootDir, stage) {
	const path = getStageSummaryPath(rootDir, stage);
	if (!(await exists(path))) {
		return null;
	}
	const raw = await readFile(path, "utf8");
	const match = raw.match(/status:\s*([a-z_]+)/i);
	return {
		path,
		raw,
		status: match?.[1]?.trim().toLowerCase() || null,
	};
}

async function writeChildTraceSnapshot({
	rootDir,
	stage,
	runId,
	sessionId,
	reason,
	pollCount,
}) {
	if (!traceChildSession || !sessionId) {
		return;
	}
	const observedArtifacts = await listObservedStageArtifacts(rootDir, stage);
	const [session, history, trace] = await Promise.allSettled([
		rpc("session.get", { sessionId }),
		rpc("session.history", { sessionId, limit: traceHistoryLimit }),
		rpc("session.trace", { sessionId, limit: traceRunLimit }),
	]);
	const debugDir = join(rootDir, "_debug", stage.id);
	await mkdir(debugDir, { recursive: true });
	const snapshot = {
		capturedAt: new Date().toISOString(),
		reason,
		pollCount,
		runId,
		sessionId,
		stageId: stage.id,
		stageName: stage.name,
		observedArtifacts,
		session: session.status === "fulfilled"
			? session.value
			: { error: session.reason instanceof Error ? session.reason.message : String(session.reason) },
		history: history.status === "fulfilled"
			? history.value
			: { error: history.reason instanceof Error ? history.reason.message : String(history.reason) },
		trace: trace.status === "fulfilled"
			? trace.value
			: { error: trace.reason instanceof Error ? trace.reason.message : String(trace.reason) },
	};
	const filename = `${String(pollCount).padStart(4, "0")}-${sanitizeFilePart(reason)}.json`;
	await writeFile(join(debugDir, filename), JSON.stringify(snapshot, null, 2), "utf8");
}

async function waitForStageReady({ runId, sessionId, rootDir, stage }) {
	const deadline = Date.now() + liveStageTimeoutMs;
	let pollCount = 0;
	while (Date.now() < deadline) {
		pollCount += 1;
		const outputsReady = await areStageArtifactsReady(rootDir, stage);
		const stageSummaryState = outputsReady ? await readStageSummaryState(rootDir, stage) : null;
		if (outputsReady && stageSummaryState?.status === "success") {
			await writeChildTraceSnapshot({
				rootDir,
				stage,
				runId,
				sessionId,
				reason: "ready_stage_summary",
				pollCount,
			});
			return {
				status: "ready_stage_summary",
				response: `Stage summary marked success at ${stageSummaryState.path}.`,
			};
		}
		if (advanceOnOutputs && outputsReady) {
			await writeChildTraceSnapshot({
				rootDir,
				stage,
				runId,
				sessionId,
				reason: "ready_outputs",
				pollCount,
			});
			return {
				status: "ready_outputs",
				response: "Expected outputs detected in the playbook artifacts root.",
			};
		}
		const timeoutMs = Math.min(agentWaitTimeoutMs, Math.max(1, deadline - Date.now()));
		const result = await rpc("agent.wait", {
			runId,
			sessionId,
			timeoutMs,
		});
		if (
			traceChildSession &&
			sessionId &&
			(
				pollCount === 1 ||
				pollCount % traceChildPollInterval === 0 ||
				(result?.status && result.status !== "timeout")
			)
		) {
			await writeChildTraceSnapshot({
				rootDir,
				stage,
				runId,
				sessionId,
				reason: result?.status ?? "timeout",
				pollCount,
			});
		}
		if (result?.status && result.status !== "timeout") {
			return result;
		}
	}
	const observedArtifacts = await listObservedStageArtifacts(rootDir, stage);
	await writeChildTraceSnapshot({
		rootDir,
		stage,
		runId,
		sessionId,
		reason: "stage_timeout",
		pollCount,
	});
	return {
		status: "timeout",
		response: `Timed out waiting for child run ${runId} for stage ${stage.name} after ${liveStageTimeoutMs}ms.`,
		observedArtifacts,
	};
}

async function writePlaceholderArtifact(fullPath, relativePath, stage) {
	await mkdir(dirname(fullPath), { recursive: true });
	const lower = relativePath.toLowerCase();
	if (lower.endsWith(".json")) {
		await writeFile(fullPath, JSON.stringify({
			generatedBy: "scripts/e2e/understudy-playbook.mjs",
			stageId: stage.id,
			stageName: stage.name,
			artifactPath: relativePath,
			generatedAt: new Date().toISOString(),
		}, null, 2), "utf8");
		return;
	}
	if (lower.endsWith(".md") || lower.endsWith(".txt")) {
		await writeFile(fullPath, [
			`# ${stage.name}`,
			"",
			`Synthetic artifact for ${relativePath}.`,
			"",
			`- stageId: ${stage.id}`,
			`- stageKind: ${stage.kind}`,
		].join("\n"), "utf8");
		return;
	}
	if (lower.endsWith(".png")) {
		await writeFile(fullPath, Buffer.from(TINY_PNG, "base64"));
		return;
	}
	if (lower.endsWith(".mp4")) {
		await writeFile(fullPath, "");
		return;
	}
	await writeFile(fullPath, `Synthetic artifact for ${relativePath}\n`, "utf8");
}

async function ensureStageArtifacts(rootDir, stage, options = {}) {
	const produced = [];
	const synthesized = [];
	for (const output of Array.isArray(stage.outputs) ? stage.outputs : []) {
		const alternatives = stageOutputAlternatives(output);
		if (alternatives.length === 0) {
			continue;
		}
		const existingPath = await (async () => {
			for (const artifactPath of alternatives) {
				if (await exists(join(rootDir, artifactPath))) {
					return artifactPath;
				}
			}
			return null;
		})();
		const artifactPath = existingPath || alternatives[0];
		const fullPath = join(rootDir, artifactPath);
		if (!existingPath) {
			if (options.allowSynthesis !== true) {
				throw new Error(`Expected artifact missing after stage ${stage.name}: ${output}`);
			}
			await writePlaceholderArtifact(fullPath, artifactPath, stage);
			synthesized.push(artifactPath);
		}
		produced.push(artifactPath);
	}
	return { produced, synthesized };
}

function findLaunchInfo(result) {
	return result.skillLaunch ?? result.workerLaunch ?? result.inlineLaunch ?? null;
}

function buildCompletionSummary({ stage, waitResult, artifacts, synthetic }) {
	if (synthetic) {
		return `Synthetic e2e completion for ${stage.name}. Produced ${artifacts.produced.join(", ") || "no explicit artifacts"}.`;
	}
	if (waitResult?.response) {
		return summarize(waitResult.response);
	}
	return `Completed ${stage.name}. Produced ${artifacts.produced.join(", ") || "no explicit artifacts"}.`;
}

function buildFailureSummary({ stage, waitResult, observedArtifacts, error }) {
	const lines = [
		waitResult?.response
			? summarize(waitResult.response)
			: `Stage ${stage.name} failed during e2e validation.`,
	];
	if (error instanceof Error && error.message.trim().length > 0) {
		lines.push("", `Harness failure: ${error.message.trim()}`);
	}
	if (Array.isArray(observedArtifacts) && observedArtifacts.length > 0) {
		lines.push("", "Observed artifacts:", ...observedArtifacts.map((entry) => `- ${entry}`));
	}
	return lines.join("\n");
}

const gateway = spawn(
	"node",
	["scripts/run-node.mjs", "gateway", "--port", String(testPort)],
	{
		cwd: repoRoot,
		env: {
			...process.env,
			UNDERSTUDY_HOME: testHome,
			...(playbookEnvFile ? { UNDERSTUDY_ENV_FILE: playbookEnvFile } : {}),
			UNDERSTUDY_GATEWAY_AUTH_MODE: "none",
			UNDERSTUDY_BROWSER_CDP_URL: reusableBrowserRelay?.cdpUrl || browserRelayUrl,
			UNDERSTUDY_BROWSER_EXTENSION_RELAY_URL: reusableBrowserRelay?.cdpUrl || browserRelayUrl,
			...(reusableBrowserRelay
				? {
					UNDERSTUDY_BROWSER_EXTENSION_RELAY_AUTH_MODE: reusableBrowserRelay.authMode || "none",
					...(reusableBrowserRelay.gatewayToken
						? {
							UNDERSTUDY_BROWSER_EXTENSION_RELAY_GATEWAY_TOKEN: reusableBrowserRelay.gatewayToken,
						}
						: {}),
				}
				: {}),
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
	}
}

let outcome = "pass";
let failureMessage = "";
let failureStageId = "";
let failureStageName = "";
let stoppedAfterStageLimit = false;

try {
	await mkdir(testHome, { recursive: true });
	await seedAuthFiles(testHome);
	await ensureWorkspace();
	await waitForGateway();

	const parentSession = await rpc("session.create", {
		workspaceDir,
		forceNew: true,
	});
	assert(parentSession?.id, "session.create did not return an id");

	const started = await rpc("playbook.run.start", {
		workspaceDir,
		playbookName,
		runId: `run_${Date.now()}`,
		inputs: playbookInputs,
	});
	assert(started?.run?.id, "playbook.run.start did not return a run id");

	let finalRun = null;
	for (let step = 0; step < 20; step += 1) {
		const next = await rpc("playbook.run.next", {
			workspaceDir,
			runId: started.run.id,
			parentSessionId: parentSession.id,
		});
		const stage = next?.stage;
		assert(stage?.id, "playbook.run.next did not return a stage");

		if (next.mode === "approval") {
			finalRun = await rpc("playbook.run.stage.complete", {
				workspaceDir,
				runId: started.run.id,
				stageId: stage.id,
				status: "completed",
				approvalState: "approved",
				approvalNote: "Approved by the playbook e2e harness.",
				summary: "Approval granted by the generic playbook e2e harness.",
			});
			stageReports.push({
				stageId: stage.id,
				stageName: stage.name,
				mode: next.mode,
				status: "completed",
				approvalState: "approved",
			});
			break;
		}

		const launch = findLaunchInfo(next);
		let waitResult = null;
		try {
			if (!syntheticMode && launch?.spawn?.runId) {
				waitResult = await waitForStageReady({
					runId: launch.spawn.runId,
					sessionId: launch.spawn.childSessionId ?? launch.spawn.sessionId,
					rootDir: next.run.artifacts.rootDir,
					stage,
				});
				if (waitResult?.status === "ready_outputs" && abortOnOutputReady && (launch.spawn.childSessionId ?? launch.spawn.sessionId)) {
					await rpc("chat.abort", {
						sessionId: launch.spawn.childSessionId ?? launch.spawn.sessionId,
					}).catch(() => null);
				}
				if (waitResult?.status === "timeout" && (launch.spawn.childSessionId ?? launch.spawn.sessionId)) {
					await rpc("chat.abort", {
						sessionId: launch.spawn.childSessionId ?? launch.spawn.sessionId,
					}).catch(() => null);
					throw new Error(waitResult.response);
				}
				if (waitResult?.status !== "ok" && waitResult?.status !== "ready_outputs") {
					throw new Error(`Child run for stage ${stage.name} finished with status ${waitResult?.status ?? "unknown"}`);
				}
			}

			const artifacts = await ensureStageArtifacts(next.run.artifacts.rootDir, stage, {
				allowSynthesis: syntheticMode,
			});
			const completed = await rpc("playbook.run.stage.complete", {
				workspaceDir,
				runId: started.run.id,
				stageId: stage.id,
				status: "completed",
				summary: buildCompletionSummary({
					stage,
				waitResult,
				artifacts,
				synthetic: syntheticMode,
			}),
				artifactPaths: artifacts.produced,
			});
			stageReports.push({
				stageId: stage.id,
				stageName: stage.name,
				mode: next.mode,
				status: "completed",
				childSessionId: launch?.spawn?.childSessionId ?? launch?.spawn?.sessionId ?? null,
				childRunId: launch?.spawn?.runId ?? null,
				producedArtifacts: artifacts.produced,
				synthesizedArtifacts: artifacts.synthesized,
				completedFromReadyOutputs:
					waitResult?.status === "ready_outputs"
					|| waitResult?.status === "ready_stage_summary",
				childResponse: waitResult?.response ? summarize(waitResult.response, 320) : null,
				notes:
					waitResult?.status === "ready_stage_summary"
						? "Advanced after the stage summary reported success and all expected outputs were present."
						: waitResult?.status === "ready_outputs"
							? "Advanced after expected outputs were detected."
					: waitResult?.response
						? summarize(waitResult.response, 160)
						: null,
			});
			finalRun = completed;
			if (stopAfterStageCount && stageReports.filter((entry) => entry.status === "completed").length >= stopAfterStageCount) {
				stoppedAfterStageLimit = true;
				break;
			}
			if (completed?.status === "completed") {
				break;
			}
		} catch (stageError) {
			const observedArtifacts = await listObservedStageArtifacts(next.run.artifacts.rootDir, stage);
			try {
				finalRun = await rpc("playbook.run.stage.complete", {
					workspaceDir,
					runId: started.run.id,
					stageId: stage.id,
					status: "failed",
					summary: buildFailureSummary({
						stage,
						waitResult,
						observedArtifacts,
						error: stageError,
					}),
					artifactPaths: observedArtifacts,
				});
			} catch {
				// Preserve the original stage failure; stage reports still record what we observed.
			}
			stageReports.push({
				stageId: stage.id,
				stageName: stage.name,
				mode: next.mode,
				status: "failed",
				childSessionId: launch?.spawn?.childSessionId ?? launch?.spawn?.sessionId ?? null,
				childRunId: launch?.spawn?.runId ?? null,
				producedArtifacts: observedArtifacts,
				synthesizedArtifacts: [],
				childResponse: waitResult?.response ? summarize(waitResult.response, 320) : null,
				notes: stageError instanceof Error ? stageError.message : String(stageError),
			});
			failureStageId = stage.id;
			failureStageName = stage.name;
			throw stageError;
		}
	}

	const fetched = await rpc("playbook.run.get", {
		workspaceDir,
		runId: started.run.id,
	});
	assert(fetched?.run, "playbook.run.get did not return the final run");
	if (!stoppedAfterStageLimit) {
		assert(fetched.run.status === "completed", `Expected completed run, received ${fetched.run.status}`);
	}
	finalRun = fetched.run;
} catch (error) {
	outcome = "fail";
	failureMessage = error instanceof Error ? error.message : String(error);
} finally {
	await stopGateway();
	await writeFile(gatewayLogPath, gatewayLog.join(""), "utf8");
}

const report = [
	"# Understudy Playbook E2E",
	"",
	`- Status: ${outcome.toUpperCase()}`,
	`- Mode: \`${e2eMode}\``,
	`- Repo root: \`${repoRoot}\``,
	`- Package version: \`${packageVersion}\``,
	`- Test home: \`${testHome}\``,
	`- Workspace dir: \`${workspaceDir}\``,
	`- Scenario: ${scenarioLabel}`,
	`- GUI expectation: ${liveGuiExpectation}`,
	`- Example source: \`${exampleWorkspaceSource ? (relative(repoRoot, exampleWorkspaceSource) || ".") : "(custom workspace)" }\``,
	`- Gateway URL: \`${gatewayUrl}\``,
	`- Playbook: \`${playbookName}\``,
	`- Target name: \`${targetName}\``,
	`- Analysis focus: \`${analysisFocus}\``,
	`- Playbook inputs: \`${JSON.stringify(playbookInputs)}\``,
	...(playbookEnvFile ? [`- Env file: \`${playbookEnvFile}\``] : []),
	...(reusableBrowserRelay
		? [
			`- Browser relay reuse: \`true\``,
			`- Browser relay source: \`${reusableBrowserRelay.source}\``,
			`- Browser relay URL: \`${reusableBrowserRelay.cdpUrl}\``,
		]
		: [`- Browser relay reuse: \`false\``]),
	`- Synthetic mode: \`${syntheticMode}\``,
	`- Advance on outputs: \`${advanceOnOutputs}\``,
	`- Stop after stage count: \`${stopAfterStageCount ?? "full run"}\``,
	`- Gateway ready timeout (ms): \`${gatewayReadyTimeoutMs}\``,
	`- Agent wait poll timeout (ms): \`${agentWaitTimeoutMs}\``,
	`- Live stage timeout (ms): \`${liveStageTimeoutMs}\``,
	...(stoppedAfterStageLimit ? ["- Partial run: stopped after requested stage count"] : []),
	...(failureStageName ? [`- Failed stage: ${failureStageName} (${failureStageId})`] : []),
	...(failureMessage ? [`- Failure: ${failureMessage}`] : []),
	"",
	"| Stage | Mode | Status | Produced Artifacts | Synthesized | Child Session | Child Run | Notes |",
	"|-------|------|--------|--------------------|-------------|---------------|-----------|-------|",
	...stageReports.map((entry) => `| ${entry.stageName} | ${entry.mode} | ${entry.status} | ${(entry.producedArtifacts ?? []).join(", ") || "-"} | ${(entry.synthesizedArtifacts ?? []).join(", ") || "-"} | ${entry.childSessionId ?? "-"} | ${entry.childRunId ?? "-"} | ${String(entry.notes ?? entry.childResponse ?? entry.approvalState ?? "-").replaceAll("|", "\\|")} |`),
	"",
	`- Gateway log: \`${gatewayLogPath}\``,
	`- JSON report: \`${reportJsonPath}\``,
].join("\n");

await writeFile(reportPath, report, "utf8");
await writeFile(reportJsonPath, JSON.stringify({
	status: outcome,
	failureMessage,
	testHome,
	workspaceDir,
	playbookName,
	targetName,
	analysisFocus,
	playbookInputs,
	playbookEnvFile,
	reusableBrowserRelay,
	mode: e2eMode,
	syntheticMode,
	advanceOnOutputs,
	stopAfterStageCount,
	stoppedAfterStageLimit,
	gatewayReadyTimeoutMs,
	agentWaitTimeoutMs,
	liveStageTimeoutMs,
	scenarioLabel,
	liveGuiExpectation,
	failureStageId,
	failureStageName,
	stageReports,
	gatewayLogPath,
	reportPath,
}, null, 2), "utf8");

console.log(report);

if (outcome !== "pass") {
	process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
