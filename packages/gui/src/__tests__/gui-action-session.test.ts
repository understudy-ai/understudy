import { describe, expect, it, vi } from "vitest";
import { GuiActionSession } from "../gui-action-session.js";

describe("GuiActionSession", () => {
	it("runs all cleanup steps even when one fails", async () => {
		const session = new GuiActionSession("gui_click");
		const cleanupA = vi.fn().mockResolvedValue(undefined);
		const cleanupB = vi.fn().mockRejectedValue(new Error("cleanup failed"));
		const cleanupC = vi.fn().mockResolvedValue(undefined);

		session.registerCleanup("cleanup-a", cleanupA);
		session.registerCleanup("cleanup-b", cleanupB);
		session.registerCleanup("cleanup-c", cleanupC);

		await expect(session.cleanup()).resolves.toBeUndefined();
		expect(cleanupA).toHaveBeenCalledTimes(1);
		expect(cleanupB).toHaveBeenCalledTimes(1);
		expect(cleanupC).toHaveBeenCalledTimes(1);
	});

	it("ignores expected Escape events inside the exemption window", () => {
		const session = new GuiActionSession("gui_key");

		session.notifyExpectedEscape();

		expect(session.handleEmergencyStop()).toBe(false);
		expect(session.signal.aborted).toBe(false);
	});
});
