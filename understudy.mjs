#!/usr/bin/env node

import module from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIN_NODE_MAJOR = 20;
const MIN_NODE_VERSION = `${MIN_NODE_MAJOR}.0.0`;

const parseNodeVersion = (rawVersion) => {
	const [majorRaw = "0"] = rawVersion.split(".");
	return Number(majorRaw);
};

if (parseNodeVersion(process.versions.node) < MIN_NODE_MAJOR) {
	process.stderr.write(
		`understudy: Node.js v${MIN_NODE_VERSION}+ is required (current: v${process.versions.node}).\n`,
	);
	process.exit(1);
}

if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
	try {
		module.enableCompileCache();
	} catch {
		// Best effort only.
	}
}

const expandHome = (value) => {
	if (value === "~") return homedir();
	if (typeof value === "string" && value.startsWith("~/")) {
		return path.join(homedir(), value.slice(2));
	}
	return value;
};

const resolveUnderstudyAgentDir = () => {
	const explicitAgentDir = process.env.UNDERSTUDY_AGENT_DIR?.trim();
	if (explicitAgentDir) {
		return expandHome(explicitAgentDir);
	}
	const explicitHomeDir = process.env.UNDERSTUDY_HOME?.trim();
	const homeDir = explicitHomeDir
		? expandHome(explicitHomeDir)
		: path.join(homedir(), ".understudy");
	return path.join(homeDir, "agent");
};

// The upstream pi-agent-core runtime reads PI_CODING_AGENT_DIR for its session
// and model storage directory.  Understudy maps this to its own agent dir so
// the runtime writes into ~/.understudy/agent instead of an upstream default.
if (!process.env.PI_CODING_AGENT_DIR?.trim()) {
	process.env.PI_CODING_AGENT_DIR = resolveUnderstudyAgentDir();
}

const workspaceCliEntry = new URL("./apps/cli/dist/bin.js", import.meta.url);
const packedBundleEntry = new URL("./dist/index.js", import.meta.url);

if (existsSync(fileURLToPath(workspaceCliEntry))) {
	await import(workspaceCliEntry.href);
} else if (existsSync(fileURLToPath(packedBundleEntry))) {
	await import(packedBundleEntry.href);
} else {
	throw new Error("understudy: missing apps/cli/dist/bin.js or dist/index.js (build output).");
}
