import { describe, expect, it } from "vitest";
import {
	renderLaunchdPlist,
	renderSystemdUserUnit,
	resolveServiceSpecForPlatform,
} from "./daemon.js";

describe("daemon service helpers", () => {
	it("renders launchd plist with gateway command", () => {
		const plist = renderLaunchdPlist({
			label: "com.understudy.daemon",
			nodePath: "/usr/local/bin/node",
			entryPath: "/repo/apps/cli/dist/index.js",
			port: 23333,
			logPath: "/tmp/understudy.log",
			cwd: "/repo",
		});

		expect(plist).toContain("com.understudy.daemon");
		expect(plist).toContain("gateway");
		expect(plist).toContain("23333");
		expect(plist).toContain("/tmp/understudy.log");
	});

	it("renders systemd user unit", () => {
		const unit = renderSystemdUserUnit({
			nodePath: "/usr/bin/node",
			entryPath: "/repo/apps/cli/dist/index.js",
			port: 23333,
			logPath: "/tmp/understudy.log",
			cwd: "/repo",
		});

		expect(unit).toContain("Description=Understudy Gateway Daemon");
		expect(unit).toContain("ExecStart=/usr/bin/node --enable-source-maps /repo/apps/cli/dist/index.js gateway --port 23333");
		expect(unit).toContain("WantedBy=default.target");
	});

	it("resolves launchd service spec", () => {
		const spec = resolveServiceSpecForPlatform("darwin", {
			port: 23333,
			cwd: "/repo",
			nodePath: "/usr/bin/node",
			entryPath: "/repo/apps/cli/dist/index.js",
			homeDir: "/Users/test",
			uid: 501,
			logPath: "/tmp/understudy.log",
		});

		expect(spec?.manager).toBe("launchd");
		expect(spec?.filePath).toContain("LaunchAgents/com.understudy.daemon.plist");
		expect(spec?.enableCommands.length).toBeGreaterThan(0);
	});

	it("resolves systemd service spec", () => {
		const spec = resolveServiceSpecForPlatform("linux", {
			port: 23333,
			cwd: "/repo",
			nodePath: "/usr/bin/node",
			entryPath: "/repo/apps/cli/dist/index.js",
			homeDir: "/home/test",
			uid: 1000,
			logPath: "/tmp/understudy.log",
		});

		expect(spec?.manager).toBe("systemd");
		expect(spec?.filePath).toContain(".config/systemd/user/understudy-daemon.service");
		expect(spec?.statusCommand?.command).toBe("systemctl");
	});
});
