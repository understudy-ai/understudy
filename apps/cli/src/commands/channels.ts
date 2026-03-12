/**
 * Channels command: manage gateway channels via RPC.
 */

import { ConfigManager } from "@understudy/core";
import { listChannelFactories } from "@understudy/channels";
import { createRpcClient } from "../rpc-client.js";

interface ChannelsOptions {
	list?: boolean;
	status?: string;
	add?: string;
	remove?: string;
	capabilities?: boolean;
	json?: boolean;
	port?: string;
}

function formatCapabilities(capabilities: Record<string, unknown> | undefined): string {
	if (!capabilities || typeof capabilities !== "object") {
		return "none";
	}
	const enabled = Object.entries(capabilities)
		.filter(([, value]) => Boolean(value))
		.map(([key]) => key);
	return enabled.length > 0 ? enabled.join(", ") : "none";
}

function buildChannelActionHints(channel: {
	id?: string;
	runtime?: { state?: string; summary?: string; lastError?: string };
}): string[] {
	const hints: string[] = [];
	const channelId = channel.id?.trim().toLowerCase();
	const runtimeState = channel.runtime?.state?.trim().toLowerCase();
	const summary = channel.runtime?.summary?.trim().toLowerCase() ?? "";
	if (runtimeState === "awaiting_pairing" || summary.includes("pair")) {
		hints.push(`Next Action: run \`understudy pairing --channel ${channelId ?? "<id>"}\` or complete the QR login flow.`);
	}
	if (runtimeState === "error" && channel.runtime?.lastError) {
		hints.push(`Recovery: inspect credentials/runtime config, then restart the gateway after fixing "${channel.runtime.lastError}".`);
	}
	if (channelId === "telegram") {
		hints.push("Setup Hint: set channels.telegram.settings.botToken or TELEGRAM_BOT_TOKEN.");
	}
	if (channelId === "discord") {
		hints.push("Setup Hint: set channels.discord.settings.botToken or DISCORD_BOT_TOKEN.");
	}
	if (channelId === "slack") {
		hints.push("Setup Hint: set channels.slack.settings.botToken and signingSecret.");
	}
	if (channelId === "whatsapp") {
		hints.push("Setup Hint: first start usually needs QR pairing before the channel reaches running state.");
	}
	return hints;
}

export async function runChannelsCommand(opts: ChannelsOptions = {}): Promise<void> {
	const client = createRpcClient({ port: opts.port ? parseInt(opts.port, 10) : undefined });

	try {
		if (opts.status) {
			const result = await client.call<any>("channel.status", { channelId: opts.status });
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
			} else {
				console.log(`Channel: ${result.id}`);
				console.log(`  Name:         ${result.name}`);
				if (result.runtime) {
					console.log(`  State:        ${result.runtime.state ?? "unknown"}`);
					if (result.runtime.summary) {
						console.log(`  Summary:      ${result.runtime.summary}`);
					}
					if (typeof result.runtime.restartAttempt === "number") {
						console.log(`  Restart Try:  ${result.runtime.restartAttempt}`);
					}
					if (result.runtime.lastError) {
						console.log(`  Last Error:   ${result.runtime.lastError}`);
					}
				}
				if (result.capabilities) {
					console.log(`  Capabilities: ${formatCapabilities(result.capabilities)}`);
				}
				for (const hint of buildChannelActionHints(result)) {
					console.log(`  ${hint}`);
				}
			}
			return;
		}

		if (opts.remove) {
			const channelId = opts.remove.trim().toLowerCase();
			try {
				await client.call("channel.logout", { channelId });
			} catch {
				// Gateway may be offline; we still apply config changes.
			}
			const configManager = await ConfigManager.load();
			const current = configManager.get();
			const existing = current.channels[channelId] ?? { enabled: false, settings: {} };
			configManager.update({
				channels: {
					[channelId]: {
						...existing,
						enabled: false,
					},
				},
			});
			configManager.save();
			console.log(`Channel disabled: ${channelId}`);
			console.log(`Saved to: ${configManager.getPath()}`);
			return;
		}

		if (opts.add) {
			const channelId = opts.add.trim().toLowerCase();
			if (!/^[a-z0-9][a-z0-9_-]*$/.test(channelId)) {
				console.error(`Invalid channel type: ${channelId}`);
				console.error("Channel IDs must match /^[a-z0-9][a-z0-9_-]*$/.");
				process.exitCode = 1;
				return;
			}
			const knownFactories = new Set(listChannelFactories());
			const knownChannel = knownFactories.has(channelId);
			const configManager = await ConfigManager.load();
			const current = configManager.get();
			const existing = current.channels[channelId] ?? { enabled: false, settings: {} };
			configManager.update({
				channels: {
					[channelId]: {
						...existing,
						enabled: true,
					},
				},
			});
			configManager.save();
			console.log(`Channel enabled: ${channelId}`);
			console.log(`Saved to: ${configManager.getPath()}`);
			if (!knownChannel) {
				console.log(`Note: ${channelId} is not a built-in channel type.`);
			}
			if (channelId === "telegram") {
				console.log("Set channels.telegram.settings.botToken (or TELEGRAM_BOT_TOKEN) before restart.");
			}
			if (channelId === "discord") {
				console.log("Set channels.discord.settings.botToken (or DISCORD_BOT_TOKEN) before restart.");
			}
			if (channelId === "slack") {
				console.log("Set channels.slack.settings.botToken/signingSecret before restart.");
			}
			if (channelId === "signal") {
				console.log("Set channels.signal.settings.sender (or SIGNAL_SENDER) before restart.");
			}
			if (channelId === "line") {
				console.log("Set channels.line.settings.channelAccessToken (or LINE_CHANNEL_ACCESS_TOKEN) before restart.");
			}
			if (channelId === "imessage") {
				console.log("iMessage channel requires macOS.");
			}
			if (knownChannel) {
				const knownList = Array.from(knownFactories).sort().join(", ");
				console.log(`Built-in channel types: ${knownList}`);
			}
			console.log("Restart gateway to apply channel changes.");
			return;
		}

		// Default: list
		const channels = await client.call<any[]>("channel.list");
		if (opts.json) {
			console.log(JSON.stringify(channels, null, 2));
			return;
		}
		if (!channels || channels.length === 0) {
			console.log("No channels registered.");
			return;
		}
		console.log(`Channels (${channels.length}):`);
		for (const ch of channels) {
			const caps = opts.capabilities && ch.capabilities
				? ` [${formatCapabilities(ch.capabilities)}]`
				: "";
			const runtime = typeof ch.runtime?.state === "string" ? ` (${ch.runtime.state})` : "";
			const summary = typeof ch.runtime?.summary === "string" && ch.runtime.summary.trim().length > 0
				? ` — ${ch.runtime.summary}`
				: "";
			console.log(`  ${ch.id} — ${ch.name ?? "unnamed"}${runtime}${caps}${summary}`);
		}
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
