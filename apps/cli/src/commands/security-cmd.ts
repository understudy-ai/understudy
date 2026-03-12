/**
 * Security command: audit configuration and generate tokens.
 */

import { randomBytes } from "node:crypto";
import { ConfigManager } from "@understudy/core";

interface SecurityOptions {
	audit?: boolean;
	generateToken?: boolean;
	config?: string;
}

export async function runSecurityCommand(opts: SecurityOptions = {}): Promise<void> {
	if (opts.generateToken) {
		const token = randomBytes(32).toString("hex");
		console.log("Generated gateway token:");
		console.log(`  ${token}`);
		console.log("\nSet via environment variable:");
		console.log(`  export UNDERSTUDY_GATEWAY_TOKEN=${token}`);
		console.log("\nOr in config.json5:");
		console.log(`  gateway: { auth: { mode: "token", token: "${token}" } }`);
		return;
	}

	// Default: audit
	console.log("Security Audit\n");
	const issues: string[] = [];
	const ok: string[] = [];

	try {
		const configManager = await ConfigManager.load(opts.config);
		const config = configManager.get();

		// Check gateway auth
		const authMode = config.gateway?.auth?.mode ?? "none";
		if (authMode === "none") {
			const host = config.gateway?.host ?? "127.0.0.1";
			if (host === "0.0.0.0" || host === "::") {
				issues.push("Gateway bound to all interfaces without authentication. Set gateway.auth.mode to 'token' or 'password'.");
			} else {
				ok.push("Gateway bound to localhost only (auth not strictly required).");
			}
		} else {
			ok.push(`Gateway auth mode: ${authMode}`);
		}

		// Check for empty tool policies
		if (config.tools.policies.length === 0) {
			issues.push("No tool policies defined. Consider adding deny rules for sensitive tools.");
		} else {
			ok.push(`${config.tools.policies.length} tool policies configured.`);
		}

		// Check for owner IDs
		if (!config.agent.ownerIds || config.agent.ownerIds.length === 0) {
			issues.push("No owner IDs configured. Any user on authorized channels can interact.");
		} else {
			ok.push(`${config.agent.ownerIds.length} owner IDs configured.`);
		}

	} catch (error) {
		issues.push(`Config load error: ${error instanceof Error ? error.message : String(error)}`);
	}

	// Check env vars
	if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length < 20) {
		issues.push("ANTHROPIC_API_KEY appears too short — may be truncated.");
	}

	for (const item of ok) {
		console.log(`  [OK]   ${item}`);
	}
	for (const item of issues) {
		console.log(`  [WARN] ${item}`);
	}

	console.log(`\n${ok.length} passed, ${issues.length} warnings`);
	if (issues.length > 0) {
		process.exitCode = 1;
	}
}
