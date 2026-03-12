/**
 * Health command: fetch and display gateway health status.
 */

import { createRpcClient } from "../rpc-client.js";

interface HealthOptions {
	json?: boolean;
	timeout?: string;
	port?: string;
}

export async function runHealthCommand(opts: HealthOptions = {}): Promise<void> {
	const port = opts.port ? parseInt(opts.port, 10) : undefined;
	const timeout = opts.timeout ? parseInt(opts.timeout, 10) : 5000;
	const client = createRpcClient({ port, timeout });

	try {
		const health = await client.health();

		if (opts.json) {
			console.log(JSON.stringify(health, null, 2));
			return;
		}

		console.log("Gateway Health:");
		console.log(`  Status:   ${health.status}`);
		if (health.version) console.log(`  Version:  ${health.version}`);
		if (typeof health.uptime === "number") {
			const uptimeSec = Math.floor(health.uptime / 1000);
			const h = Math.floor(uptimeSec / 3600);
			const m = Math.floor((uptimeSec % 3600) / 60);
			const s = uptimeSec % 60;
			console.log(`  Uptime:   ${h}h ${m}m ${s}s`);
		}
		if (Array.isArray(health.channels)) {
			console.log(`  Channels: ${health.channels.join(", ") || "none"}`);
		}
		if (health.auth && typeof health.auth === "object") {
			console.log(`  Auth:     ${(health.auth as any).mode}`);
		}
		if (health.memory && typeof health.memory === "object") {
			const mem = health.memory as any;
			const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(1);
			console.log(`  Memory:   ${heapMB} MB heap used`);
		}
	} catch (error) {
		console.error("Failed to reach gateway:", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
