import { describe, expect, it } from "vitest";
import { resolveOpenExternalPathAttempts } from "./open-path.js";

describe("resolveOpenExternalPathAttempts", () => {
	it("opens chrome:// targets through Chromium apps on macOS before falling back", () => {
		expect(resolveOpenExternalPathAttempts("chrome://extensions", "darwin")).toEqual([
			{ command: "open", args: ["-a", "Google Chrome", "chrome://extensions"] },
			{ command: "open", args: ["-a", "Google Chrome Canary", "chrome://extensions"] },
			{ command: "open", args: ["-a", "Chromium", "chrome://extensions"] },
			{ command: "open", args: ["-a", "Arc", "chrome://extensions"] },
			{ command: "open", args: ["chrome://extensions"] },
		]);
	});

	it("uses the default platform opener for normal targets", () => {
		expect(resolveOpenExternalPathAttempts("/tmp/example", "darwin")).toEqual([
			{ command: "open", args: ["/tmp/example"] },
		]);
		expect(resolveOpenExternalPathAttempts("https://example.com", "linux")).toEqual([
			{ command: "xdg-open", args: ["https://example.com"] },
		]);
	});
});
