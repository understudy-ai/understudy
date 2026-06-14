import { describe, expect, it } from "vitest";
import { isGuiPlatformSupported, resolveGuiPlatformBackend } from "../platform.js";

describe("resolveGuiPlatformBackend", () => {
	it("returns the macOS backend on darwin", () => {
		const backend = resolveGuiPlatformBackend("darwin");

		expect(backend.id).toBe("macos");
		expect(backend.supported).toBe(true);
		expect(isGuiPlatformSupported("darwin")).toBe(true);
	});

	it("returns the Windows backend on win32", () => {
		const backend = resolveGuiPlatformBackend("win32");

		expect(backend.id).toBe("windows");
		expect(backend.supported).toBe(true);
		expect(backend.toolSupport.gui_key).toMatchObject({
			supported: true,
		});
		expect(backend.toolSupport.gui_observe).toMatchObject({
			supported: true,
		});
		expect(backend.toolSupport.gui_type).toMatchObject({
			supported: true,
		});
		expect(backend.toolSupport.gui_click).toMatchObject({
			supported: true,
		});
		expect(backend.toolSupport.gui_drag).toMatchObject({
			supported: true,
		});
		expect(backend.toolSupport.gui_scroll).toMatchObject({
			supported: true,
		});
		expect(backend.toolSupport.gui_move).toMatchObject({
			supported: true,
		});
		expect(isGuiPlatformSupported("win32")).toBe(true);
	});
});
