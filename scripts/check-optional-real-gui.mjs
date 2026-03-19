import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

async function hasRealGuiScript() {
	try {
		const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
		const parsed = JSON.parse(raw);
		return typeof parsed?.scripts?.["test:gui:real"] === "string";
	} catch {
		return false;
	}
}

const shouldRunRealGui =
	process.platform === "darwin" &&
	(process.env.UNDERSTUDY_CHECK_REAL_GUI === "1" || process.env.UNDERSTUDY_RUN_REAL_GUI_TESTS === "1");

if (!shouldRunRealGui) {
	process.exit(0);
}

if (!(await hasRealGuiScript())) {
	console.warn("Skipping optional real GUI checks because `test:gui:real` is not defined.");
	process.exit(0);
}

const child = spawn("pnpm", ["test:gui:real"], {
	stdio: "inherit",
	shell: process.platform === "win32",
	env: {
		...process.env,
		UNDERSTUDY_RUN_REAL_GUI_TESTS: "1",
	},
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});

child.on("error", (error) => {
	console.error(`Failed to run optional real GUI checks: ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
});
