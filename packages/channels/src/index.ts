import type { ChannelAdapter } from "@understudy/types";
import { asNumber, asString, asStringArray } from "@understudy/core";
import { DiscordChannel } from "./discord/discord-channel.js";
import { IMessageChannel } from "./imessage/imessage-channel.js";
import { LineChannel } from "./line/line-channel.js";
import { SignalChannel } from "./signal/signal-channel.js";
import { SlackChannel } from "./slack/slack-channel.js";
import { TelegramChannel } from "./telegram/telegram-channel.js";
import { WebChannel } from "./web/web-channel.js";
import { WhatsAppChannel } from "./whatsapp/whatsapp-channel.js";

// Web (WebSocket)
export { WebChannel } from "./web/web-channel.js";
export type { WebChannelOptions } from "./web/web-channel.js";

// Telegram
export { TelegramChannel } from "./telegram/telegram-channel.js";
export type { TelegramChannelOptions } from "./telegram/telegram-channel.js";

// Discord
export { DiscordChannel } from "./discord/discord-channel.js";
export type { DiscordChannelOptions } from "./discord/discord-channel.js";

// Slack
export { SlackChannel } from "./slack/slack-channel.js";
export type { SlackChannelOptions } from "./slack/slack-channel.js";

// WhatsApp
export { WhatsAppChannel } from "./whatsapp/whatsapp-channel.js";
export type { WhatsAppChannelOptions } from "./whatsapp/whatsapp-channel.js";

// Signal
export { SignalChannel } from "./signal/signal-channel.js";
export type { SignalChannelOptions } from "./signal/signal-channel.js";

// LINE
export { LineChannel } from "./line/line-channel.js";
export type { LineChannelOptions } from "./line/line-channel.js";

// iMessage
export { IMessageChannel } from "./imessage/imessage-channel.js";
export type { IMessageChannelOptions } from "./imessage/imessage-channel.js";

interface ChannelConfigInput {
	enabled?: boolean;
	settings?: Record<string, unknown>;
}

interface ChannelFactoryContext {
	channelId: string;
	settings: Record<string, unknown>;
	host: string;
	webPort: number;
	env: NodeJS.ProcessEnv;
}

interface ChannelFactoryResult {
	channel?: ChannelAdapter;
	warning?: string;
}

export type ChannelFactory = (context: ChannelFactoryContext) => ChannelFactoryResult;

const channelFactoryRegistry = new Map<string, ChannelFactory>();

function pickSettingString(settings: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = asString(settings[key]);
		if (value) return value;
	}
	return undefined;
}

export function registerChannelFactory(channelId: string, factory: ChannelFactory): void {
	channelFactoryRegistry.set(channelId.trim().toLowerCase(), factory);
}

export function listChannelFactories(): string[] {
	return Array.from(channelFactoryRegistry.keys()).sort();
}

function createChannelFromFactory(context: ChannelFactoryContext): ChannelFactoryResult {
	const factory = channelFactoryRegistry.get(context.channelId);
	if (!factory) {
		return { warning: `Ignoring unknown enabled channel "${context.channelId}".` };
	}
	return factory(context);
}

export function buildChannelsFromConfig(params: {
	channels: Record<string, ChannelConfigInput>;
	host: string;
	webPort: number;
	env?: NodeJS.ProcessEnv;
}): { channels: ChannelAdapter[]; warnings: string[] } {
	const channels: ChannelAdapter[] = [];
	const warnings: string[] = [];
	const env = params.env ?? process.env;

	for (const [rawChannelId, config] of Object.entries(params.channels ?? {})) {
		if (!config?.enabled) continue;
		const channelId = rawChannelId.trim().toLowerCase();
		if (!channelId) continue;
		const result = createChannelFromFactory({
			channelId,
			settings:
				config.settings && typeof config.settings === "object" && !Array.isArray(config.settings)
					? config.settings
					: {},
			host: params.host,
			webPort: params.webPort,
			env,
		});
		if (result.channel) {
			channels.push(result.channel);
		}
		if (result.warning) {
			warnings.push(result.warning);
		}
	}

	return { channels, warnings };
}

let defaultFactoriesRegistered = false;

function registerDefaultChannelFactories(): void {
	if (defaultFactoriesRegistered) return;
	defaultFactoriesRegistered = true;

	registerChannelFactory("web", ({ host, webPort }) => ({
		channel: new WebChannel({ host, port: webPort }),
	}));

	registerChannelFactory("telegram", ({ settings, env }) => {
		const botToken =
			pickSettingString(settings, ["botToken"]) ??
			asString(env.TELEGRAM_BOT_TOKEN);
		if (!botToken) {
			return {
				warning:
					"Channel telegram is enabled but bot token is missing (channels.telegram.settings.botToken or TELEGRAM_BOT_TOKEN).",
			};
		}
		return {
			channel: new TelegramChannel({
				botToken,
				allowedChatIds: asStringArray(settings.allowedChatIds),
			}),
		};
	});

	registerChannelFactory("discord", ({ settings, env }) => {
		const botToken =
			pickSettingString(settings, ["botToken"]) ??
			asString(env.DISCORD_BOT_TOKEN);
		if (!botToken) {
			return {
				warning:
					"Channel discord is enabled but bot token is missing (channels.discord.settings.botToken or DISCORD_BOT_TOKEN).",
			};
		}
		return {
			channel: new DiscordChannel({
				botToken,
				allowedGuildIds: asStringArray(settings.allowedGuildIds),
			}),
		};
	});

	registerChannelFactory("slack", ({ settings, env }) => {
		const botToken =
			pickSettingString(settings, ["botToken"]) ??
			asString(env.SLACK_BOT_TOKEN);
		const signingSecret =
			pickSettingString(settings, ["signingSecret"]) ??
			asString(env.SLACK_SIGNING_SECRET);
		if (!botToken || !signingSecret) {
			return {
				warning:
					"Channel slack is enabled but credentials are missing (botToken/signingSecret or SLACK_BOT_TOKEN/SLACK_SIGNING_SECRET).",
			};
		}
		return {
			channel: new SlackChannel({
				botToken,
				signingSecret,
				appToken:
					pickSettingString(settings, ["appToken"]) ??
					asString(env.SLACK_APP_TOKEN),
				port: asNumber(settings.port),
				allowedChannelIds: asStringArray(settings.allowedChannelIds),
				allowedUserIds: asStringArray(settings.allowedUserIds),
			}),
		};
	});

	registerChannelFactory("whatsapp", ({ settings }) => ({
		channel: new WhatsAppChannel({
			allowedNumbers: asStringArray(settings.allowedNumbers),
		}),
	}));

	registerChannelFactory("signal", ({ settings, env }) => {
		const sender =
			pickSettingString(settings, ["sender"]) ??
			asString(env.SIGNAL_SENDER);
		if (!sender) {
			return {
				warning:
					"Channel signal is enabled but sender is missing (channels.signal.settings.sender or SIGNAL_SENDER).",
			};
		}
		return {
			channel: new SignalChannel({
				sender,
				cliPath:
					pickSettingString(settings, ["cliPath"]) ??
					asString(env.SIGNAL_CLI_PATH),
				timeoutMs: asNumber(settings.timeoutMs),
			}),
		};
	});

	registerChannelFactory("line", ({ settings, env }) => {
		const channelAccessToken =
			pickSettingString(settings, ["channelAccessToken"]) ??
			asString(env.LINE_CHANNEL_ACCESS_TOKEN);
		if (!channelAccessToken) {
			return {
				warning:
					"Channel line is enabled but access token is missing (channels.line.settings.channelAccessToken or LINE_CHANNEL_ACCESS_TOKEN).",
			};
		}
		return {
			channel: new LineChannel({
				channelAccessToken,
				apiBaseUrl: pickSettingString(settings, ["apiBaseUrl"]),
			}),
		};
	});

	registerChannelFactory("imessage", ({ settings }) => {
		if (process.platform !== "darwin") {
			return {
				warning: "Channel imessage is only supported on macOS and has been skipped.",
			};
		}
		return {
			channel: new IMessageChannel({
				serviceName: pickSettingString(settings, ["serviceName"]),
			}),
		};
	});
}

registerDefaultChannelFactories();
