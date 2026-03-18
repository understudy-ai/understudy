import { describe, expect, it } from "vitest";
import { normalizeRuntimePlatformCapabilities } from "../platform-capabilities.js";

describe("normalizeRuntimePlatformCapabilities", () => {
	it("preserves core fields when a plugin extends the same capability id", () => {
		const normalized = normalizeRuntimePlatformCapabilities([
			{
				id: "desktop_gui",
				label: "Desktop GUI",
				description: "Core desktop automation surface",
				source: "core",
				tags: ["desktop", "core"],
				metadata: {
					owner: "core",
					shared: "core",
				},
			},
			{
				id: "desktop_gui",
				label: "Plugin GUI Override",
				description: "Plugin override should not replace the core description",
				source: "plugin",
				tags: ["plugin"],
				metadata: {
					shared: "plugin",
					extension: "enabled",
				},
			},
		]);

		expect(normalized).toEqual([
			{
				id: "desktop_gui",
				label: "Desktop GUI",
				description: "Core desktop automation surface",
				source: "core",
				tags: ["core", "desktop", "plugin"],
				metadata: {
					owner: "core",
					shared: "core",
					extension: "enabled",
				},
			},
		]);
	});
});
