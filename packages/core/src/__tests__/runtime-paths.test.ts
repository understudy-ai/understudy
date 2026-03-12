import { afterEach, describe, expect, it } from "vitest";
import {
	ensureRuntimeEngineAgentDirEnv,
	getDefaultUnderstudyAgentDir,
	getDefaultUnderstudyHomeDir,
	getUnderstudySessionDir,
	resolveUnderstudyAgentDir,
	resolveUnderstudyHomeDir,
	encodeSessionScope,
} from "../runtime-paths.js";

const originalEngineAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalUnderstudyAgentDir = process.env.UNDERSTUDY_AGENT_DIR;
const originalUnderstudyHome = process.env.UNDERSTUDY_HOME;

afterEach(() => {
	if (originalEngineAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
	} else {
		process.env.PI_CODING_AGENT_DIR = originalEngineAgentDir;
	}

	if (originalUnderstudyAgentDir === undefined) {
		delete process.env.UNDERSTUDY_AGENT_DIR;
	} else {
		process.env.UNDERSTUDY_AGENT_DIR = originalUnderstudyAgentDir;
	}

	if (originalUnderstudyHome === undefined) {
		delete process.env.UNDERSTUDY_HOME;
	} else {
		process.env.UNDERSTUDY_HOME = originalUnderstudyHome;
	}
});

describe("runtime path helpers", () => {
	it("resolves Understudy home dir with override, env, then default", () => {
		process.env.UNDERSTUDY_HOME = "/tmp/understudy-home";
		expect(resolveUnderstudyHomeDir("/tmp/explicit-home")).toBe("/tmp/explicit-home");
		expect(resolveUnderstudyHomeDir()).toBe("/tmp/understudy-home");

		delete process.env.UNDERSTUDY_HOME;
		expect(resolveUnderstudyHomeDir()).toBe(getDefaultUnderstudyHomeDir());
	});

	it("resolves Understudy agent dir with explicit override first", () => {
		process.env.UNDERSTUDY_AGENT_DIR = "/tmp/from-understudy-env";
		expect(resolveUnderstudyAgentDir("/tmp/explicit")).toBe("/tmp/explicit");
	});

	it("falls back to UNDERSTUDY_AGENT_DIR then default", () => {
		delete process.env.UNDERSTUDY_AGENT_DIR;
		delete process.env.UNDERSTUDY_HOME;
		expect(resolveUnderstudyAgentDir()).toBe(getDefaultUnderstudyAgentDir());

		process.env.UNDERSTUDY_AGENT_DIR = "/tmp/from-understudy-env";
		expect(resolveUnderstudyAgentDir()).toBe("/tmp/from-understudy-env");
	});

	it("uses UNDERSTUDY_HOME as fallback base for agent dir", () => {
		delete process.env.UNDERSTUDY_AGENT_DIR;
		process.env.UNDERSTUDY_HOME = "/tmp/custom-understudy-home";

		expect(resolveUnderstudyAgentDir()).toBe("/tmp/custom-understudy-home/agent");
	});

	it("sets engine storage env to resolved Understudy runtime dir", () => {
		const resolved = ensureRuntimeEngineAgentDirEnv("/tmp/understudy-agent");
		expect(resolved).toBe("/tmp/understudy-agent");
		expect(process.env.PI_CODING_AGENT_DIR).toBe("/tmp/understudy-agent");
	});

	it("builds stable encoded session scope and session dir", () => {
		expect(encodeSessionScope("/home/dev/workspace/my-project")).toBe(
			"--home-dev-workspace-my-project--",
		);

		expect(getUnderstudySessionDir("/repo/demo", "/tmp/understudy-agent")).toBe(
			"/tmp/understudy-agent/sessions/--repo-demo--",
		);
	});
});
