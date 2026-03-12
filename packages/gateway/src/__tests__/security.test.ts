import { describe, it, expect } from "vitest";
import { PairingManager } from "../security.js";

describe("PairingManager", () => {
	it("generates pairing codes", () => {
		const mgr = PairingManager.inMemory();
		const code = mgr.generateCode("telegram");

		expect(code).toHaveLength(8);
		expect(code).toMatch(/^[A-Z2-9]+$/);
	});

	it("approves valid pairing codes", () => {
		const mgr = PairingManager.inMemory();
		const code = mgr.generateCode("telegram");

		const approved = mgr.approve(code, "telegram", "user123");
		expect(approved).toBe(true);
		expect(mgr.isAllowed("telegram", "user123")).toBe(true);
	});

	it("rejects invalid pairing codes", () => {
		const mgr = PairingManager.inMemory();
		mgr.generateCode("telegram");

		const approved = mgr.approve("WRONGCODE", "telegram", "user123");
		expect(approved).toBe(false);
		expect(mgr.isAllowed("telegram", "user123")).toBe(false);
	});

	it("rejects codes for wrong channel", () => {
		const mgr = PairingManager.inMemory();
		const code = mgr.generateCode("telegram");

		const approved = mgr.approve(code, "discord", "user123");
		expect(approved).toBe(false);
	});

	it("removes pairing request after approval", () => {
		const mgr = PairingManager.inMemory();
		const code = mgr.generateCode("telegram");

		mgr.approve(code, "telegram", "user123");
		const pending = mgr.listPending("telegram");
		expect(pending).toHaveLength(0);
	});

	it("enforces max pending per channel", () => {
		const mgr = PairingManager.inMemory();
		mgr.generateCode("telegram");
		mgr.generateCode("telegram");
		mgr.generateCode("telegram");
		mgr.generateCode("telegram"); // Should remove oldest

		const pending = mgr.listPending("telegram");
		expect(pending).toHaveLength(3);
	});

	it("manages allowlist entries", () => {
		const mgr = PairingManager.inMemory();

		mgr.addAllowed("telegram", "user1");
		mgr.addAllowed("telegram", "user2");
		mgr.addAllowed("discord", "user1");

		expect(mgr.isAllowed("telegram", "user1")).toBe(true);
		expect(mgr.isAllowed("telegram", "user3")).toBe(false);

		const telegramAllowed = mgr.listAllowed("telegram");
		expect(telegramAllowed).toHaveLength(2);

		const allAllowed = mgr.listAllowed();
		expect(allAllowed).toHaveLength(3);
	});

	it("removes allowed entries", () => {
		const mgr = PairingManager.inMemory();
		mgr.addAllowed("telegram", "user1");

		expect(mgr.removeAllowed("telegram", "user1")).toBe(true);
		expect(mgr.isAllowed("telegram", "user1")).toBe(false);

		expect(mgr.removeAllowed("telegram", "user1")).toBe(false);
	});

	it("handles case-insensitive code approval", () => {
		const mgr = PairingManager.inMemory();
		const code = mgr.generateCode("telegram");

		const approved = mgr.approve(code.toLowerCase(), "telegram", "user1");
		expect(approved).toBe(true);
	});

	it("idempotent addAllowed", () => {
		const mgr = PairingManager.inMemory();
		mgr.addAllowed("telegram", "user1");
		mgr.addAllowed("telegram", "user1");

		expect(mgr.listAllowed("telegram")).toHaveLength(1);
	});
});
