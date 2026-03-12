import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { inspectProviderAuthStatuses, runRuntimePreflight } from "@understudy/core";
import { inspectGuiEnvironmentReadiness } from "@understudy/gui";
import type { UnderstudyConfig } from "@understudy/types";
import {
	resolveBrowserExtensionInstallDir,
	resolveConfiguredBrowserConnectionMode,
} from "./browser-extension.js";
import {
	collectVideoTeachReadinessChecks,
	type RuntimeReadinessCheck,
} from "./gateway-runtime-readiness.js";

const execFileAsync = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);

function toNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export interface SetupChecklistItem {
	id: string;
	label: string;
	status: "ok" | "warn" | "error";
	summary: string;
	detail?: string;
	fix?: string;
	openTarget?: string;
}

function packageInstalled(name: string): boolean {
	try {
		requireFromHere.resolve(name);
		return true;
	} catch {
		return false;
	}
}

async function binaryAvailable(binary: string, args: string[]): Promise<boolean> {
	try {
		await execFileAsync(binary, args, {
			timeout: 5_000,
			maxBuffer: 256 * 1024,
			encoding: "utf8",
		});
		return true;
	} catch {
		return false;
	}
}

function mapReadinessStatus(
	status: RuntimeReadinessCheck["status"],
): SetupChecklistItem["status"] {
	if (status === "error") {
		return "error";
	}
	if (status === "warn") {
		return "warn";
	}
	return "ok";
}

function formatLine(item: SetupChecklistItem): string {
	const prefix = item.status === "ok"
		? "[OK]"
		: item.status === "warn"
			? "[WARN]"
			: "[ERR]";
	const parts = [`${prefix} ${item.label}: ${item.summary}`];
	if (item.fix) {
		parts.push(`    fix: ${item.fix}`);
	}
	return parts.join("\n");
}

function channelSettings(config: UnderstudyConfig, channelId: string): Record<string, unknown> {
	const raw = config.channels?.[channelId]?.settings;
	return raw && typeof raw === "object" && !Array.isArray(raw)
		? raw as Record<string, unknown>
		: {};
}

function hasConfiguredToken(config: UnderstudyConfig, channelId: string, keys: string[], envKeys: string[]): boolean {
	const settings = channelSettings(config, channelId);
	return keys.some((key) => toNonEmptyString(settings[key])) ||
		envKeys.some((key) => toNonEmptyString(process.env[key]));
}

function hasGatewayBrowserToken(config: UnderstudyConfig): boolean {
	return Boolean(
		toNonEmptyString(process.env.UNDERSTUDY_GATEWAY_TOKEN) ??
		toNonEmptyString(config.gateway?.auth?.token),
	);
}

async function collectChannelChecklist(config: UnderstudyConfig): Promise<SetupChecklistItem[]> {
	const items: SetupChecklistItem[] = [];
	const enabled = Object.entries(config.channels ?? {})
		.filter(([, value]) => value?.enabled)
		.map(([channelId]) => channelId)
		.sort();

	for (const channelId of enabled) {
		switch (channelId) {
			case "telegram":
				items.push({
					id: "channel-telegram",
					label: "Telegram Channel",
					status: hasConfiguredToken(config, "telegram", ["botToken"], ["TELEGRAM_BOT_TOKEN"])
						? packageInstalled("grammy")
							? "ok"
							: "warn"
						: "warn",
					summary: hasConfiguredToken(config, "telegram", ["botToken"], ["TELEGRAM_BOT_TOKEN"])
						? packageInstalled("grammy")
							? "Ready for bot token auth."
							: "Token is configured, but grammY is missing."
						: "Bot token is missing.",
					fix: !packageInstalled("grammy")
						? 'Install optional dependency "grammy".'
						: 'Set channels.telegram.settings.botToken or TELEGRAM_BOT_TOKEN.',
				});
				break;
			case "discord":
				items.push({
					id: "channel-discord",
					label: "Discord Channel",
					status: hasConfiguredToken(config, "discord", ["botToken"], ["DISCORD_BOT_TOKEN"])
						? packageInstalled("discord.js")
							? "ok"
							: "warn"
						: "warn",
					summary: hasConfiguredToken(config, "discord", ["botToken"], ["DISCORD_BOT_TOKEN"])
						? packageInstalled("discord.js")
							? "Ready for bot login."
							: "Token is configured, but discord.js is missing."
						: "Bot token is missing.",
					fix: !packageInstalled("discord.js")
						? 'Install optional dependency "discord.js".'
						: 'Set channels.discord.settings.botToken or DISCORD_BOT_TOKEN.',
				});
				break;
			case "slack": {
				const hasBotToken = hasConfiguredToken(config, "slack", ["botToken"], ["SLACK_BOT_TOKEN"]);
				const hasSigningSecret = hasConfiguredToken(config, "slack", ["signingSecret"], ["SLACK_SIGNING_SECRET"]);
				const installed = packageInstalled("@slack/bolt");
				items.push({
					id: "channel-slack",
					label: "Slack Channel",
					status: hasBotToken && hasSigningSecret
						? installed
							? "ok"
							: "warn"
						: "warn",
					summary: hasBotToken && hasSigningSecret
						? installed
							? "Ready for Events or Socket Mode."
							: "Credentials are configured, but @slack/bolt is missing."
						: "Bot token or signing secret is missing.",
					fix: !installed
						? 'Install optional dependency "@slack/bolt".'
						: "Set Slack bot token and signing secret in config or environment.",
				});
				break;
			}
			case "whatsapp": {
				const hasBaileys = packageInstalled("@whiskeysockets/baileys");
				const hasQr = packageInstalled("qrcode-terminal");
				items.push({
					id: "channel-whatsapp",
					label: "WhatsApp Channel",
					status: hasBaileys && hasQr ? "ok" : "warn",
					summary: hasBaileys && hasQr
						? "Ready for QR pairing."
						: "Optional channel packages are missing.",
					fix: 'Install optional dependencies "@whiskeysockets/baileys" and "qrcode-terminal".',
				});
				break;
				}
				case "signal": {
					const senderReady = hasConfiguredToken(config, "signal", ["sender"], ["SIGNAL_SENDER"]);
					const cliReady = await binaryAvailable(toNonEmptyString(channelSettings(config, "signal").cliPath) ?? "signal-cli", ["--version"]);
					items.push({
					id: "channel-signal",
					label: "Signal Channel",
					status: senderReady && cliReady ? "ok" : "warn",
					summary: senderReady
						? cliReady
							? "Ready for outbound Signal sends."
							: "Sender is configured, but signal-cli is missing."
						: "Signal sender is missing.",
					fix: !senderReady
						? "Set channels.signal.settings.sender or SIGNAL_SENDER."
						: "Install signal-cli and keep it on PATH, or set channels.signal.settings.cliPath.",
				});
				break;
			}
			case "line":
				items.push({
					id: "channel-line",
					label: "LINE Channel",
					status: hasConfiguredToken(config, "line", ["channelAccessToken"], ["LINE_CHANNEL_ACCESS_TOKEN"])
						? "ok"
						: "warn",
					summary: hasConfiguredToken(config, "line", ["channelAccessToken"], ["LINE_CHANNEL_ACCESS_TOKEN"])
						? "Ready for push API sends."
						: "Channel access token is missing.",
					fix: "Set channels.line.settings.channelAccessToken or LINE_CHANNEL_ACCESS_TOKEN.",
				});
				break;
			case "imessage": {
				const supported = process.platform === "darwin";
				const osascriptReady = supported && await binaryAvailable("osascript", ["-e", "return 1"]);
				items.push({
					id: "channel-imessage",
					label: "iMessage Channel",
					status: supported && osascriptReady ? "ok" : "warn",
					summary: supported && osascriptReady
						? "Ready for Messages.app sends."
						: supported
							? "osascript is unavailable."
							: "iMessage channel only works on macOS.",
					fix: supported
						? "Ensure osascript is available and Messages.app is configured."
						: "Use iMessage only on macOS hosts.",
				});
				break;
			}
			default:
				break;
		}
	}

	return items;
}

export async function collectSetupChecklist(config: UnderstudyConfig): Promise<SetupChecklistItem[]> {
	const items: SetupChecklistItem[] = [];
	const provider = toNonEmptyString(config.defaultProvider);
	if (provider) {
		const authStatus = inspectProviderAuthStatuses([provider]).get(provider);
		items.push({
			id: "default-model-auth",
			label: "Default Model Auth",
			status: authStatus?.available ? "ok" : "warn",
			summary: authStatus?.available
				? `${provider} auth is available (${authStatus.source}).`
				: `${provider} has no detected auth yet.`,
			fix: authStatus?.available
				? undefined
				: `Configure ${provider} credentials in the wizard or environment before first run.`,
		});
	}

	const preflight = runRuntimePreflight({
		profile: "assistant",
		toolNames: ["browser", "schedule"],
	});
	const browserDependency = preflight.dependencies.playwright;
	items.push({
		id: "browser-runtime-package",
		label: "Browser Runtime Package",
		status: browserDependency?.available ? "ok" : "warn",
		summary: browserDependency?.available ? "Playwright package is installed." : "Playwright package is missing.",
		fix: browserDependency?.available ? undefined : 'Run "pnpm install" (or install the "playwright" package) before using browser automation.',
	});

	const browserMode = resolveConfiguredBrowserConnectionMode(config);
	if (browserMode !== "managed") {
		const installDir = resolveBrowserExtensionInstallDir({ config });
		const manifestPath = join(installDir, "manifest.json");
		const extensionInstalled = existsSync(manifestPath);
		const relayTokenConfigured = hasGatewayBrowserToken(config);
			items.push({
				id: "browser-extension-route",
				label: "Browser Extension Relay",
				status: extensionInstalled && relayTokenConfigured ? "ok" : "warn",
				summary:
					extensionInstalled && relayTokenConfigured
						? `Chrome extension relay is configured at ${installDir}.`
						: !extensionInstalled
							? `Chrome extension is not installed at ${installDir}.`
							: "Gateway auth token for the browser extension relay is missing.",
			fix:
				!extensionInstalled
					? 'Run "understudy wizard" and choose Browser extension, then load it from chrome://extensions.'
					: "Set gateway.auth.token or UNDERSTUDY_GATEWAY_TOKEN before using the browser extension relay.",
			openTarget: installDir,
		});
	}

	const tesseractReady = await binaryAvailable("tesseract", ["--version"]);
	items.push({
		id: "vision-read-ocr",
		label: "On-device OCR",
		status: tesseractReady ? "ok" : "warn",
		summary: tesseractReady
			? "tesseract is available for vision_read OCR."
			: "tesseract is missing; local OCR will be unavailable in vision_read.",
		fix: tesseractReady ? undefined : 'Install "tesseract" if you want local OCR in the vision_read tool.',
	});

	const guiReadiness = await inspectGuiEnvironmentReadiness();
	for (const check of guiReadiness.checks) {
		const openTarget = check.id === "accessibility"
			? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
			: check.id === "screen_recording"
				? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
				: undefined;
		const fix = check.id === "native_helper"
			? 'Install Xcode Command Line Tools with "xcode-select --install".'
			: openTarget
				? "Open the matching macOS privacy pane and enable Understudy or your terminal."
				: undefined;
		items.push({
			id: `gui-${check.id}`,
			label: check.label,
			status: check.status === "unsupported"
				? "warn"
				: check.status === "error"
					? "error"
					: check.status === "warn"
						? "warn"
						: "ok",
			summary: check.summary,
			detail: check.detail,
			fix,
			openTarget,
		});
	}

	const teachChecks = await collectVideoTeachReadinessChecks(config);
	for (const check of teachChecks) {
		items.push({
			id: `teach-${check.id}`,
			label: check.label,
			status: mapReadinessStatus(check.status),
			summary: check.summary,
			detail: check.detail,
			fix: check.id === "video-teach-ffmpeg" || check.id === "video-teach-ffprobe"
				? 'Install ffmpeg/ffprobe if you want video teach analysis.'
				: check.id === "video-teach-events" || check.id === "video-teach-recording"
					? process.platform === "darwin"
						? 'Install Xcode Command Line Tools with "xcode-select --install".'
						: "Demo recording currently targets macOS hosts."
					: undefined,
		});
	}

	items.push(...await collectChannelChecklist(config));
	return items;
}

export function formatSetupChecklist(items: SetupChecklistItem[]): string {
	if (items.length === 0) {
		return "No setup requirements detected.";
	}
	return items.map(formatLine).join("\n");
}
