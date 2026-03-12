/**
 * LifecycleManager: handles graceful shutdown, signal handling, and active task tracking.
 */

import type { GatewayServer } from "./server.js";
import type { GatewayLock } from "./lock.js";

export interface ActiveTask {
	id: string;
	channelId?: string;
	startedAt: number;
}

export interface LifecycleManagerOptions {
	gateway: GatewayServer;
	lock?: GatewayLock;
	drainTimeoutMs?: number;
	shutdownTimeoutMs?: number;
	onShutdown?: () => Promise<void>;
}

export class LifecycleManager {
	private gateway: GatewayServer;
	private lock?: GatewayLock;
	private drainTimeoutMs: number;
	private shutdownTimeoutMs: number;
	private onShutdown?: () => Promise<void>;
	private activeTasks = new Map<string, ActiveTask>();
	private shuttingDown = false;
	private signalCount = 0;
	private signalHandlers: Array<{ signal: string; handler: () => void }> = [];

	constructor(options: LifecycleManagerOptions) {
		this.gateway = options.gateway;
		this.lock = options.lock;
		this.drainTimeoutMs = options.drainTimeoutMs ?? 30_000;
		this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
		this.onShutdown = options.onShutdown;
	}

	/** Install signal handlers */
	install(): void {
		const handleShutdown = () => {
			this.signalCount++;
			if (this.signalCount >= 2) {
				console.log("\nForce exit.");
				this.lock?.release();
				process.exit(1);
			}
			this.shutdown().catch((error) => {
				console.error("Shutdown error:", error);
				process.exit(1);
			});
		};

		for (const signal of ["SIGTERM", "SIGINT"] as const) {
			const handler = () => handleShutdown();
			process.on(signal, handler);
			this.signalHandlers.push({ signal, handler });
		}
	}

	/** Uninstall signal handlers */
	uninstall(): void {
		for (const { signal, handler } of this.signalHandlers) {
			process.removeListener(signal, handler);
		}
		this.signalHandlers = [];
	}

	/** Track an active task */
	trackTask(id: string, channelId?: string): void {
		this.activeTasks.set(id, { id, channelId, startedAt: Date.now() });
	}

	/** Untrack a completed task */
	untrackTask(id: string): void {
		this.activeTasks.delete(id);
	}

	/** Get count of active tasks */
	get activeTaskCount(): number {
		return this.activeTasks.size;
	}

	/** List active tasks */
	listActiveTasks(): ActiveTask[] {
		return Array.from(this.activeTasks.values());
	}

	/** Whether shutdown is in progress */
	get isShuttingDown(): boolean {
		return this.shuttingDown;
	}

	/** Perform graceful shutdown */
	async shutdown(): Promise<void> {
		if (this.shuttingDown) return;
		this.shuttingDown = true;

		console.log("\nShutting down gateway...");

		// Drain phase: wait for active tasks to complete
		if (this.activeTasks.size > 0) {
			console.log(`Waiting for ${this.activeTasks.size} active task(s) to complete...`);
			const drainStart = Date.now();
			while (this.activeTasks.size > 0 && Date.now() - drainStart < this.drainTimeoutMs) {
				await sleep(250);
			}
			if (this.activeTasks.size > 0) {
				console.log(`Drain timeout: ${this.activeTasks.size} task(s) still active, proceeding with shutdown.`);
			}
		}

		// Custom shutdown callback
		if (this.onShutdown) {
			try {
				await this.onShutdown();
			} catch (error) {
				console.error("Error in shutdown callback:", error);
			}
		}

		// Shutdown phase: stop gateway with timeout
		try {
			await Promise.race([
				this.gateway.stop(),
				sleep(this.shutdownTimeoutMs).then(() => {
					console.log("Gateway stop timed out, forcing exit.");
				}),
			]);
		} catch (error) {
			console.error("Error stopping gateway:", error);
		}

		// Release lock
		this.lock?.release();
		this.uninstall();

		process.exit(0);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
