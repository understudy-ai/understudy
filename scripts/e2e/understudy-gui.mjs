#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const testHome = process.env.TEST_HOME?.trim() || await mkdtemp(join(tmpdir(), "understudy-gui-e2e-"));
const groundingProviders = process.env.UNDERSTUDY_REAL_GROUNDING_PROVIDERS?.trim() || "openai";
const groundingConcurrency = process.env.UNDERSTUDY_REAL_GROUNDING_CONCURRENCY?.trim() || "2";
const skipGroundingBenchmark = process.env.UNDERSTUDY_GUI_E2E_SKIP_GROUNDING === "1";
const reportPath = join(testHome, "understudy-gui-report.md");
const cases = [];

async function runCommand(label, command, args, env = {}) {
	return await new Promise((resolveRun) => {
		const child = spawn(command, args, {
			cwd: repoRoot,
			env: {
				...process.env,
				...env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr?.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("exit", (code) => {
			resolveRun({
				label,
				code: code ?? 0,
				stdout,
				stderr,
			});
		});
	});
}

function summarizeOutput(result) {
	const combined = `${result.stdout}\n${result.stderr}`.trim().replace(/\s+/g, " ");
	return combined.length <= 260 ? combined : `${combined.slice(0, 257)}...`;
}

async function runCase(id, title, command, args, env) {
	const startedAt = Date.now();
	const result = await runCommand(title, command, args, env);
	cases.push({
		id,
		title,
		status: result.code === 0 ? "pass" : "fail",
		durationMs: Date.now() - startedAt,
		detail: summarizeOutput(result),
		outputPath: join(testHome, `${id}.log`),
	});
	await writeFile(
		join(testHome, `${id}.log`),
		[`# STDOUT`, result.stdout, ``, `# STDERR`, result.stderr].join("\n"),
		"utf8",
	);
}

if (skipGroundingBenchmark) {
	cases.push({
		id: "G-01",
		title: "Grounding Benchmark",
		status: "skip",
		durationMs: 0,
		detail: "Skipped because UNDERSTUDY_GUI_E2E_SKIP_GROUNDING=1. Use the standalone grounding benchmark result for this run.",
		outputPath: "",
	});
} else {
	await runCase(
		"G-01",
		"Grounding Benchmark",
		"pnpm",
		["exec", "vitest", "--run", "apps/cli/src/commands/gui-grounding.real.test.ts"],
		{
			UNDERSTUDY_RUN_REAL_GROUNDING_TESTS: "1",
			UNDERSTUDY_REAL_GROUNDING_PROVIDERS: groundingProviders,
			UNDERSTUDY_REAL_GROUNDING_CONCURRENCY: groundingConcurrency,
		},
	);
}

await runCase(
	"G-02",
	"GUI Runtime Browser Smoke",
	"pnpm",
	["exec", "vitest", "--run", "-t", "drives click, right click, double click, hover, click and hold, drag, scroll, type, keypress, hotkey, screenshot, and wait against a real browser window", "packages/gui/src/__tests__/runtime.real.test.ts"],
	{
		UNDERSTUDY_RUN_REAL_GUI_TESTS: "1",
	},
);

await runCase(
	"G-03",
	"GUI Runtime Finder Smoke",
	"pnpm",
	["exec", "vitest", "--run", "-t", "drives native Finder navigation hotkey and screenshot flows", "packages/gui/src/__tests__/runtime.real.test.ts"],
	{
		UNDERSTUDY_RUN_REAL_GUI_TESTS: "1",
	},
);

await runCase(
	"G-04",
	"GUI Runtime TextEdit Smoke",
	"pnpm",
	["exec", "vitest", "--run", "-t", "drives native TextEdit hotkey, typing, keypress, and screenshot flows", "packages/gui/src/__tests__/runtime.real.test.ts"],
	{
		UNDERSTUDY_RUN_REAL_GUI_TESTS: "1",
	},
);

await runCase(
	"G-05",
	"Demonstration Recorder Smoke",
	"pnpm",
	["exec", "vitest", "--run", "packages/gui/src/__tests__/demonstration-recorder.real.test.ts"],
	{
		UNDERSTUDY_RUN_REAL_GUI_TESTS: "1",
	},
);

const report = [
	"# Understudy GUI / Layer1 E2E",
	"",
	`- Repo root: \`${repoRoot}\``,
	`- Test home: \`${testHome}\``,
	`- Grounding providers: \`${groundingProviders}\``,
	`- Grounding concurrency: \`${groundingConcurrency}\``,
	`- Grounding benchmark skipped: \`${skipGroundingBenchmark}\``,
	"",
	"| Case | Status | Duration (ms) | Detail | Log |",
	"|------|--------|---------------|--------|-----|",
	...cases.map((entry) =>
		`| ${entry.id} ${entry.title} | ${entry.status.toUpperCase()} | ${entry.durationMs} | ${String(entry.detail).replace(/\|/g, "\\|")} | ${entry.outputPath ? `\`${entry.outputPath}\`` : "-"} |`
	),
].join("\n");

await writeFile(reportPath, report, "utf8");
console.log(report);

if (cases.some((entry) => entry.status === "fail")) {
	process.exitCode = 1;
}

process.exit(process.exitCode ?? 0);
