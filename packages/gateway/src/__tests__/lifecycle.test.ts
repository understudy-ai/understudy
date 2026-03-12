import { describe, it, expect } from "vitest";
import { LifecycleManager } from "../lifecycle.js";

// Minimal mock of GatewayServer
const mockGateway = {
	stop: async () => {},
	router: { listChannels: () => [], startAll: async () => {}, stopAll: async () => {} },
} as any;

describe("LifecycleManager", () => {
	it("tracks and untracks active tasks", () => {
		const lifecycle = new LifecycleManager({ gateway: mockGateway });
		expect(lifecycle.activeTaskCount).toBe(0);

		lifecycle.trackTask("task-1", "telegram");
		lifecycle.trackTask("task-2", "discord");
		expect(lifecycle.activeTaskCount).toBe(2);

		const tasks = lifecycle.listActiveTasks();
		expect(tasks).toHaveLength(2);
		expect(tasks[0].id).toBe("task-1");
		expect(tasks[0].channelId).toBe("telegram");

		lifecycle.untrackTask("task-1");
		expect(lifecycle.activeTaskCount).toBe(1);

		lifecycle.untrackTask("task-2");
		expect(lifecycle.activeTaskCount).toBe(0);
	});

	it("reports isShuttingDown", () => {
		const lifecycle = new LifecycleManager({ gateway: mockGateway });
		expect(lifecycle.isShuttingDown).toBe(false);
	});

	it("installs and uninstalls signal handlers", () => {
		const lifecycle = new LifecycleManager({ gateway: mockGateway });
		lifecycle.install();
		// Should not throw
		lifecycle.uninstall();
	});
});
