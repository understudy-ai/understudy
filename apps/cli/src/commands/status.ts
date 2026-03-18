/**
 * Status command: show agent and gateway status.
 */

interface StatusOptions {
	all?: boolean;
	json?: boolean;
}

interface GatewayProbeResult {
	host: string;
	port: number;
	health: Record<string, unknown>;
	detectedBy: "lock" | "probe";
}

interface GatewayCandidate {
	host: string;
	port: number;
	detectedBy: "lock" | "probe";
}

async function resolveGatewayProbe(lockPort?: number): Promise<GatewayProbeResult | undefined> {
	const { createRpcClient } = await import("../rpc-client.js");
	const { ConfigManager } = await import("@understudy/core");
	const configManager = await ConfigManager.load();
	const config = configManager.get();
	const configuredHost = config.gateway?.host ?? "127.0.0.1";
	const configuredPort = config.gateway?.port ?? 23333;
	const candidates: GatewayCandidate[] = [];
	const seen = new Set<string>();

	const pushCandidate = (candidate: GatewayCandidate): void => {
		const key = `${candidate.host}:${candidate.port}`;
		if (seen.has(key)) {
			return;
		}
		seen.add(key);
		candidates.push(candidate);
	};

	if (typeof lockPort === "number" && Number.isFinite(lockPort) && lockPort > 0) {
		pushCandidate({ host: configuredHost, port: lockPort, detectedBy: "lock" });
		pushCandidate({ host: "127.0.0.1", port: lockPort, detectedBy: "lock" });
	}
	pushCandidate({ host: configuredHost, port: configuredPort, detectedBy: "probe" });

	for (const candidate of candidates) {
		try {
			const client = createRpcClient({
				host: candidate.host,
				port: candidate.port,
				timeout: 1500,
			});
			const health = await client.health();
			return { ...candidate, health };
		} catch {
			// Try the next candidate; status should fall back to "not running".
		}
	}

	return undefined;
}

export async function runStatusCommand(opts: StatusOptions): Promise<void> {
	const { resolveUnderstudyHomeDir, resolveUnderstudyPackageVersion } = await import("@understudy/core");
	const { existsSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { GatewayLock } = await import("@understudy/gateway");

	const homeDir = resolveUnderstudyHomeDir();
	const lockPath = join(homeDir, "gateway.lock");
	const lockData = GatewayLock.read(lockPath);
	const probe = await resolveGatewayProbe(lockData?.port);

	const status: Record<string, unknown> = {
		version: resolveUnderstudyPackageVersion(import.meta.dirname) ?? "0.0.0",
		homeDir,
		configPath: join(homeDir, "config.json5"),
		configExists: existsSync(join(homeDir, "config.json5")),
	};

	if (probe) {
		status.gateway = {
			running: true,
			pid: lockData?.pid,
			host: probe.host,
			port: probe.port,
			startedAt: lockData?.startedAt,
			detectedBy: probe.detectedBy,
		};

		if (opts.all) {
			status.health = probe.health;
		}
	} else {
		status.gateway = { running: false };
		if (lockData) {
			status.gateway = {
				running: false,
				staleLock: {
					pid: lockData.pid,
					port: lockData.port,
					startedAt: lockData.startedAt,
				},
			};
		}
	}

	if (opts.json) {
		console.log(JSON.stringify(status, null, 2));
	} else {
		console.log(`Understudy v${status.version}`);
		console.log(`  Home:    ${status.homeDir}`);
		console.log(`  Config:  ${status.configExists ? "found" : "not found"}`);
		if (probe) {
			const probeSuffix = probe.detectedBy === "probe" ? ", detected by health probe" : "";
			const pidSuffix = typeof lockData?.pid === "number" ? `PID ${lockData.pid}, ` : "";
			console.log(`  Gateway: running (${pidSuffix}${probe.host}:${probe.port}${probeSuffix})`);
		} else if (lockData) {
			console.log(`  Gateway: not running (stale lock for PID ${lockData.pid}, port ${lockData.port})`);
		} else {
			console.log(`  Gateway: not running`);
		}
	}
}
