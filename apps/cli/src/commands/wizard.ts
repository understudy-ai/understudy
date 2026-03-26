/**
 * Interactive setup wizard for Understudy configuration.
 */

import { AuthManager, ConfigManager, asStringArray, inspectProviderAuthStatuses } from "@understudy/core";
import { listChannelFactories } from "@understudy/channels";
import type { ChannelConfig, UnderstudyConfig } from "@understudy/types";
import { runDaemonCommand } from "./daemon.js";
import { asRecord, asString } from "./gateway-support.js";
import {
	describeChromeExtensionInstallNextSteps,
	resolveBrowserExtensionInstallDir,
	resolveConfiguredBrowserConnectionMode,
} from "./browser-extension.js";
import { createBrowserExtensionRelayController } from "./browser-extension-relay-controller.js";
import { installBrowserExtensionIntoConfig } from "./browser-extension-setup.js";
import { openExternalPath } from "./open-path.js";
import { collectSetupChecklist, formatSetupChecklist } from "./setup-checklist.js";
import { createWizardUi, type WizardChoiceOption, WizardCancelledError } from "./wizard-ui.js";
import { BUILTIN_MODELS, parseThinkingLevel } from "./model-support.js";

interface WizardOptions {
	config?: string;
	yes?: boolean;
}

type ThinkingLevel = UnderstudyConfig["defaultThinkingLevel"];
type SetupMode = "quickstart" | "advanced";
type SetupSection = "model" | "browser" | "permissions" | "memory" | "channels" | "daemon";

type OAuthProviderLike = {
	id?: string;
	name?: string;
};

const THINKING_LEVELS: ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
];

const MANUAL_CHOICE = "__manual__";
const SKIP_CHOICE = "__skip__";

const CHANNEL_CATALOG = [
	{ id: "telegram", label: "Telegram", hint: "Bot token, private and group chats" },
	{ id: "discord", label: "Discord", hint: "Bot token, guilds, threads, DMs" },
	{ id: "slack", label: "Slack", hint: "Bot token + signing secret" },
	{ id: "whatsapp", label: "WhatsApp", hint: "Pairing QR, live phone account" },
	{ id: "signal", label: "Signal", hint: "signal-cli outbound setup" },
	{ id: "line", label: "LINE", hint: "Push API access token" },
	{ id: "imessage", label: "iMessage", hint: "macOS Messages automation" },
] as const;

const ADVANCED_SECTION_OPTIONS: Array<WizardChoiceOption<SetupSection>> = [
	{ value: "model", label: "Model and auth", hint: "Default provider, model, thinking level" },
	{ value: "browser", label: "Browser extension", hint: "Install the Chrome extension relay" },
	{ value: "permissions", label: "GUI permissions and local tools", hint: "Accessibility, Screen Recording, ffmpeg, channel deps" },
	{ value: "memory", label: "Memory", hint: "Enable/disable memory and DB path" },
	{ value: "channels", label: "Channels", hint: "Telegram, Discord, Slack, WhatsApp, Signal, LINE, iMessage" },
	{ value: "daemon", label: "Background service", hint: "Install launchd/systemd gateway service" },
];

function cloneConfig(config: UnderstudyConfig): UnderstudyConfig {
	return JSON.parse(JSON.stringify(config)) as UnderstudyConfig;
}

function normalizeChannelConfig(channel?: ChannelConfig): ChannelConfig {
	return {
		enabled: Boolean(channel?.enabled),
		settings: asRecord(channel?.settings),
	};
}

function nonEmpty(value: string, fallback: string): string {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : fallback;
}

export function parseCommaList(value: string): string[] | undefined {
	const normalized = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
	return normalized.length > 0 ? normalized : undefined;
}

export function normalizeThinkingLevel(
	value: string,
	fallback: ThinkingLevel,
): ThinkingLevel {
	try {
		return parseThinkingLevel(value) ?? fallback;
	} catch {
		return fallback;
	}
}

function boolLabel(value: boolean): string {
	return value ? "enabled" : "disabled";
}

function buildEnabledChannelsList(config: UnderstudyConfig): string[] {
	return Object.entries(config.channels)
		.filter(([, channel]) => channel?.enabled)
		.map(([id]) => id)
		.sort();
}

function buildBrowserSummary(config: UnderstudyConfig): string {
	const mode = resolveConfiguredBrowserConnectionMode(config);
	if (mode === "managed") {
		return "mode=managed";
	}
	return [
		`mode=${mode}`,
		`extension=${resolveBrowserExtensionInstallDir({ config })}`,
	].join(", ");
}

export function buildWizardSummary(
	configPath: string,
	config: UnderstudyConfig,
	notices: string[],
): string {
	const enabledChannels = buildEnabledChannelsList(config);
	const lines = [
		"Understudy setup completed.",
		`Config saved: ${configPath}`,
		`Default model: ${config.defaultProvider}/${config.defaultModel}`,
		`Thinking level: ${config.defaultThinkingLevel}`,
		`Browser: ${buildBrowserSummary(config)}`,
		`Memory: ${boolLabel(config.memory.enabled)}`,
		`Enabled channels: ${enabledChannels.length > 0 ? enabledChannels.join(", ") : "none"}`,
	];
	if (notices.length > 0) {
		lines.push("", "Notices:");
		for (const notice of notices) {
			lines.push(`- ${notice}`);
		}
	}
	return lines.join("\n");
}

function buildCurrentConfigOverview(configPath: string, config: UnderstudyConfig): string {
	const enabledChannels = buildEnabledChannelsList(config);
	return [
		`Config path: ${configPath}`,
		`Current model: ${config.defaultProvider}/${config.defaultModel}`,
		`Current browser: ${buildBrowserSummary(config)}`,
		`Current memory: ${boolLabel(config.memory.enabled)}`,
		`Current channels: ${enabledChannels.length > 0 ? enabledChannels.join(", ") : "none"}`,
	].join("\n");
}

function buildAuthBadge(provider: string): string {
	const status = inspectProviderAuthStatuses([provider]).get(provider);
	if (!status?.available) {
		return "no auth";
	}
	switch (status.source) {
		case "primary":
			return status.credentialType === "oauth" ? "oauth" : "api key";
		case "env":
			return "env api key";
		default:
			return "auth";
	}
}

async function loginOAuthProvider(params: {
	authManager: AuthManager;
	providerId: string;
	notices: string[];
}) {
	const { authManager, providerId, notices } = params;
	console.log(`Starting login for ${providerId}...`);
	try {
		await authManager.authStorage.login(providerId as never, {
			onAuth: async (info: { url?: string; instructions?: string }) => {
				if (info.instructions) {
					console.log(info.instructions);
				}
				if (info.url) {
					console.log(`Open this URL to continue:\n${info.url}`);
					const opened = await openExternalPath(info.url);
					if (!opened.ok) {
						console.log("Could not open the browser automatically. Visit the URL manually.");
					}
				}
			},
			onPrompt: async (prompt: { message?: string; placeholder?: string }) => {
				const ui = createWizardUi();
				return await ui.text({
					message: prompt.message?.trim() || `Provide ${providerId} login input`,
					placeholder: prompt.placeholder,
				});
			},
			onProgress: (message: string) => {
				if (typeof message === "string" && message.trim().length > 0) {
					console.log(message.trim());
				}
			},
		});
		console.log(`Login completed for ${providerId}.`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		notices.push(`OAuth login for ${providerId} did not complete: ${message}`);
		console.log(`Login failed for ${providerId}: ${message}`);
	}
}

async function maybeConfigureOAuthProviders(
	ui: ReturnType<typeof createWizardUi>,
	notices: string[],
): Promise<void> {
	const authManager = AuthManager.create();
	const oauthProviders = authManager.authStorage.getOAuthProviders()
		.map((provider) => ({
			id: typeof provider.id === "string" ? provider.id.trim() : "",
			name: typeof provider.name === "string" ? provider.name.trim() : "",
		}))
		.filter((provider): provider is Required<OAuthProviderLike> => provider.id.length > 0)
		.sort((left, right) => (left.name || left.id).localeCompare(right.name || right.id));
	if (oauthProviders.length === 0) {
		return;
	}

	const wantsLogin = await ui.confirm({
		message: "Sign in to an OAuth provider before choosing the default model?",
		initialValue: false,
	});
	if (!wantsLogin) {
		return;
	}

	for (;;) {
		const choice = await ui.select({
			message: "Choose an OAuth provider to sign in",
			options: [
				{ value: SKIP_CHOICE, label: "Continue without more logins", hint: "Keep the current auth state" },
				...oauthProviders.map((provider) => ({
					value: provider.id,
					label: provider.name || provider.id,
					hint: buildAuthBadge(provider.id),
				})),
			],
			initialValue: SKIP_CHOICE,
		});
		if (choice === SKIP_CHOICE) {
			return;
		}
		await loginOAuthProvider({
			authManager,
			providerId: choice,
			notices,
		});
	}
}

function groupAvailableModels(authManager: AuthManager): Map<string, string[]> {
	const merged = new Map<string, Set<string>>();
	// Seed with builtin models so picker works even without auth
	for (const [provider, models] of Object.entries(BUILTIN_MODELS)) {
		merged.set(provider, new Set(models));
	}
	for (const model of authManager.getAvailableModels()) {
		const provider = model.provider.trim();
		const modelId = model.id.trim();
		if (!provider || !modelId) {
			continue;
		}
		if (!merged.has(provider)) {
			merged.set(provider, new Set());
		}
		merged.get(provider)!.add(modelId);
	}
	return new Map(
		Array.from(merged.entries())
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([provider, models]) => [provider, Array.from(models).sort()]),
	);
}

async function configureModelDefaults(params: {
	ui: ReturnType<typeof createWizardUi>;
	config: UnderstudyConfig;
	notices: string[];
	advanced: boolean;
}) {
	await maybeConfigureOAuthProviders(params.ui, params.notices);

	const authManager = AuthManager.create();
	const availableModels = groupAvailableModels(authManager);
	if (availableModels.size > 0) {
		const providerChoice = await params.ui.select({
			message: "Choose the default provider",
			options: [
				...Array.from(availableModels.entries()).map(([provider, models]) => ({
					value: provider,
					label: provider,
					hint: `${models.length} model${models.length === 1 ? "" : "s"} · ${buildAuthBadge(provider)}`,
				})),
				{ value: MANUAL_CHOICE, label: "Manual entry", hint: "Type provider and model IDs yourself" },
			],
			initialValue: availableModels.has(params.config.defaultProvider)
				? params.config.defaultProvider
				: MANUAL_CHOICE,
		});
		if (providerChoice !== MANUAL_CHOICE) {
			params.config.defaultProvider = providerChoice;
			const models = availableModels.get(providerChoice) ?? [];
			const modelChoice = await params.ui.select({
				message: `Choose the default model for ${providerChoice}`,
				options: [
					...models.map((modelId) => ({
						value: modelId,
						label: modelId,
					})),
					{ value: MANUAL_CHOICE, label: "Manual model entry", hint: "Type a custom model ID" },
				],
				initialValue: models.includes(params.config.defaultModel)
					? params.config.defaultModel
					: models[0],
			});
			if (modelChoice !== MANUAL_CHOICE) {
				params.config.defaultModel = modelChoice;
			} else {
				params.config.defaultModel = nonEmpty(
					await params.ui.text({
						message: "Default model ID",
						initialValue: params.config.defaultModel,
					}),
					params.config.defaultModel,
				);
			}
		} else {
			params.config.defaultProvider = nonEmpty(
				await params.ui.text({
					message: "Default provider",
					initialValue: params.config.defaultProvider,
				}),
				params.config.defaultProvider,
			);
			params.config.defaultModel = nonEmpty(
				await params.ui.text({
					message: "Default model ID",
					initialValue: params.config.defaultModel,
				}),
				params.config.defaultModel,
			);
		}
	} else {
		params.notices.push("No authenticated models detected. Provider/model stayed in manual mode.");
		params.config.defaultProvider = nonEmpty(
			await params.ui.text({
				message: "Default provider",
				initialValue: params.config.defaultProvider,
			}),
			params.config.defaultProvider,
		);
		params.config.defaultModel = nonEmpty(
			await params.ui.text({
				message: "Default model ID",
				initialValue: params.config.defaultModel,
			}),
			params.config.defaultModel,
		);
	}

	params.config.defaultThinkingLevel = await params.ui.select({
		message: "Default thinking level",
		options: THINKING_LEVELS.map((value) => ({
			value,
			label: value,
		})),
		initialValue: params.config.defaultThinkingLevel,
	});

	await configureGroundingModel(params);
}

async function configureGroundingModel(params: {
	ui: ReturnType<typeof createWizardUi>;
	config: UnderstudyConfig;
	notices: string[];
}) {
	const currentProvider = params.config.agent.guiGroundingProvider?.trim() ?? params.config.defaultProvider ?? "";
	const currentModel = params.config.agent.guiGroundingModel?.trim() ?? params.config.defaultModel ?? "";
	const hasDedicated =
		Boolean(params.config.agent.guiGroundingProvider?.trim()) ||
		Boolean(params.config.agent.guiGroundingModel?.trim());
	const wantsDedicated = await params.ui.confirm({
		message: "Use a dedicated model for GUI grounding (separate from the main model)?",
		initialValue: hasDedicated,
	});
	if (!wantsDedicated) {
		delete params.config.agent.guiGroundingProvider;
		delete params.config.agent.guiGroundingModel;
		return;
	}

	const authManager = AuthManager.create();
	const availableModels = groupAvailableModels(authManager);
	const groundingProviderOptions = [
		...Array.from(availableModels.keys()).map((provider) => ({
			value: provider,
			label: provider,
			hint: buildAuthBadge(provider),
		})),
		{ value: MANUAL_CHOICE, label: "Manual entry", hint: "Type provider ID yourself" },
	];
	const providerInitial = availableModels.has(currentProvider) ? currentProvider : MANUAL_CHOICE;
	let groundingProvider: string;
	if (groundingProviderOptions.length > 1) {
		const providerChoice = await params.ui.select({
			message: "Grounding provider",
			options: groundingProviderOptions,
			initialValue: providerInitial,
		});
		if (providerChoice === MANUAL_CHOICE) {
			groundingProvider = nonEmpty(
				await params.ui.text({
					message: "Grounding provider ID",
					initialValue: currentProvider,
				}),
				params.config.defaultProvider ?? "openai-codex",
			);
		} else {
			groundingProvider = providerChoice;
		}
	} else {
		groundingProvider = nonEmpty(
			await params.ui.text({
				message: "Grounding provider ID",
				initialValue: currentProvider,
			}),
			params.config.defaultProvider ?? "openai-codex",
		);
	}

	const providerModels = availableModels.get(groundingProvider) ?? [];
	let groundingModel = currentModel;
	if (providerModels.length > 0) {
		const modelChoice = await params.ui.select({
			message: "Grounding model",
			options: [
				...providerModels.map((modelId) => ({ value: modelId, label: modelId })),
				{ value: MANUAL_CHOICE, label: "Manual model entry", hint: "Type a custom model ID" },
			],
			initialValue: providerModels.includes(currentModel) ? currentModel : MANUAL_CHOICE,
		});
		if (modelChoice === MANUAL_CHOICE) {
			groundingModel = nonEmpty(
				await params.ui.text({
					message: "Grounding model ID",
					initialValue: currentModel,
					placeholder: "e.g. gpt-5.4",
				}),
				params.config.defaultModel ?? "gpt-5.4",
			);
		} else {
			groundingModel = modelChoice;
		}
	} else {
		groundingModel = nonEmpty(
			await params.ui.text({
				message: "Grounding model ID",
				initialValue: currentModel,
				placeholder: "e.g. gpt-5.4",
			}),
			params.config.defaultModel ?? "gpt-5.4",
		);
	}

	params.config.agent.guiGroundingProvider = groundingProvider;
	params.config.agent.guiGroundingModel = groundingModel;
}

async function configureMemory(params: {
	ui: ReturnType<typeof createWizardUi>;
	config: UnderstudyConfig;
	advanced: boolean;
}) {
	const enabled = await params.ui.confirm({
		message: "Enable memory for session summaries and reusable traces?",
		initialValue: params.config.memory.enabled,
	});
	params.config.memory.enabled = enabled;
	if (!enabled) {
		return;
	}
	if (!params.advanced) {
		return;
	}
	const dbPath = (await params.ui.text({
		message: "Memory DB path",
		initialValue: asString(params.config.memory.dbPath),
		placeholder: "Leave blank to keep the default path",
	})).trim();
	if (dbPath.length > 0) {
		params.config.memory.dbPath = dbPath;
	}
}

async function maybeOpenExternalPath(params: {
	ui: ReturnType<typeof createWizardUi>;
	message: string;
	target: string;
	notices: string[];
	initialValue?: boolean;
}) {
	const wantsOpen = await params.ui.confirm({
		message: params.message,
		initialValue: params.initialValue ?? false,
	});
	if (!wantsOpen) {
		return;
	}
	const opened = await openExternalPath(params.target);
	if (!opened.ok) {
		params.notices.push(`Could not open ${params.target}: ${opened.error ?? "unknown error"}`);
	}
}

async function configureBrowser(params: {
	ui: ReturnType<typeof createWizardUi>;
	config: UnderstudyConfig;
	notices: string[];
}) {
	const wantsExtension = await params.ui.confirm({
		message: "Install and configure the Understudy Chrome extension for your current Chrome tab?",
		initialValue: resolveConfiguredBrowserConnectionMode(params.config) !== "managed",
	});

	if (!wantsExtension) {
		params.config.browser = Object.assign({}, params.config.browser, {
			connectionMode: "managed",
		});
		return;
	}

	const relayController = createBrowserExtensionRelayController();
	try {
		await params.ui.note(
			[
				"Setup will copy the extension files locally and switch browser.connectionMode to extension.",
				"You will still need to load the unpacked extension in Chrome and click the Understudy toolbar button on the tab you want to hand over.",
			].join("\n"),
			"Browser Extension",
		);
		const result = await installBrowserExtensionIntoConfig({
			config: params.config,
			relayController,
		});
		Object.assign(params.config, result.config);
		if (result.tokenSource === "generated") {
			params.notices.push("Generated gateway.auth.token for the browser extension relay.");
		}

		await params.ui.note(
			describeChromeExtensionInstallNextSteps({
				path: result.installDir,
				gatewayToken: result.gatewayToken,
			}),
			"Browser Extension",
		);
			await maybeOpenExternalPath({
				ui: params.ui,
				message: "Open chrome://extensions now?",
				target: "chrome://extensions",
				notices: params.notices,
				initialValue: true,
			});

			const wantsWait = await params.ui.confirm({
				message: "Wait until the browser extension is attached to a Chrome tab now?",
			initialValue: true,
		});
		if (!wantsWait) {
			params.notices.push("Browser extension installed. Click the Understudy toolbar button on a Chrome tab later to attach it.");
			return;
		}

		const progress = params.ui.progress("Waiting for the Understudy browser extension to connect");
		const connected = await relayController.waitForConnection({
			timeoutMs: 90_000,
			onTick: ({ remainingMs }) => {
				progress.update(`Waiting for a browser tab handoff... ${Math.ceil(remainingMs / 1000)}s left`);
			},
		});
		progress.stop(
			connected
				? "Browser extension connected."
				: "No browser tab attached yet. You can continue and attach it later.",
		);
		if (!connected) {
			params.notices.push("Browser extension installed, but no Chrome tab was attached during setup.");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		params.notices.push(`Browser extension setup failed: ${message}`);
	} finally {
		await relayController.stop();
	}
}

async function configureTelegram(
	ui: ReturnType<typeof createWizardUi>,
	config: UnderstudyConfig,
	notices: string[],
) {
	const settings = asRecord(normalizeChannelConfig(config.channels.telegram).settings);
	const tokenInput = (await ui.text({
		message: "Telegram bot token",
		initialValue: asString(settings.botToken),
		placeholder: "Leave blank to use TELEGRAM_BOT_TOKEN",
	})).trim();
	if (tokenInput.length > 0) {
		settings.botToken = tokenInput;
	}
	if (!asString(settings.botToken) && !process.env.TELEGRAM_BOT_TOKEN) {
		notices.push("Telegram is enabled without a bot token in config or environment.");
	}

	const allowedDefault = asStringArray(settings.allowedChatIds)?.join(", ") ?? "";
	const allowedInput = (await ui.text({
		message: "Telegram allowed chat IDs (optional, comma-separated)",
		initialValue: allowedDefault,
		placeholder: 'Type "none" to clear',
	})).trim();
	if (allowedInput.toLowerCase() === "none") {
		delete settings.allowedChatIds;
	} else if (allowedInput.length > 0) {
		settings.allowedChatIds = parseCommaList(allowedInput) ?? [];
	}

	config.channels.telegram = { enabled: true, settings };
}

async function configureDiscord(
	ui: ReturnType<typeof createWizardUi>,
	config: UnderstudyConfig,
	notices: string[],
) {
	const settings = asRecord(normalizeChannelConfig(config.channels.discord).settings);
	const tokenInput = (await ui.text({
		message: "Discord bot token",
		initialValue: asString(settings.botToken),
		placeholder: "Leave blank to use DISCORD_BOT_TOKEN",
	})).trim();
	if (tokenInput.length > 0) {
		settings.botToken = tokenInput;
	}
	if (!asString(settings.botToken) && !process.env.DISCORD_BOT_TOKEN) {
		notices.push("Discord is enabled without a bot token in config or environment.");
	}

	const guildsDefault = asStringArray(settings.allowedGuildIds)?.join(", ") ?? "";
	const guildsInput = (await ui.text({
		message: "Discord allowed guild IDs (optional, comma-separated)",
		initialValue: guildsDefault,
		placeholder: 'Type "none" to clear',
	})).trim();
	if (guildsInput.toLowerCase() === "none") {
		delete settings.allowedGuildIds;
	} else if (guildsInput.length > 0) {
		settings.allowedGuildIds = parseCommaList(guildsInput) ?? [];
	}

	config.channels.discord = { enabled: true, settings };
}

async function configureSlack(
	ui: ReturnType<typeof createWizardUi>,
	config: UnderstudyConfig,
	notices: string[],
) {
	const settings = asRecord(normalizeChannelConfig(config.channels.slack).settings);
	const botTokenInput = (await ui.text({
		message: "Slack bot token",
		initialValue: asString(settings.botToken),
		placeholder: "Leave blank to use SLACK_BOT_TOKEN",
	})).trim();
	const signingSecretInput = (await ui.text({
		message: "Slack signing secret",
		initialValue: asString(settings.signingSecret),
		placeholder: "Leave blank to use SLACK_SIGNING_SECRET",
	})).trim();
	const appTokenInput = (await ui.text({
		message: "Slack app token for Socket Mode (optional)",
		initialValue: asString(settings.appToken),
		placeholder: 'Type "none" to clear',
	})).trim();

	if (botTokenInput.length > 0) settings.botToken = botTokenInput;
	if (signingSecretInput.length > 0) settings.signingSecret = signingSecretInput;
	if (appTokenInput.toLowerCase() === "none") {
		delete settings.appToken;
	} else if (appTokenInput.length > 0) {
		settings.appToken = appTokenInput;
	}

	if ((!asString(settings.botToken) && !process.env.SLACK_BOT_TOKEN) ||
		(!asString(settings.signingSecret) && !process.env.SLACK_SIGNING_SECRET)) {
		notices.push("Slack is enabled without a bot token or signing secret in config or environment.");
	}

	const allowedChannelsDefault = asStringArray(settings.allowedChannelIds)?.join(", ") ?? "";
	const allowedChannelsInput = (await ui.text({
		message: "Slack allowed channel IDs (optional, comma-separated)",
		initialValue: allowedChannelsDefault,
		placeholder: 'Type "none" to clear',
	})).trim();
	if (allowedChannelsInput.toLowerCase() === "none") {
		delete settings.allowedChannelIds;
	} else if (allowedChannelsInput.length > 0) {
		settings.allowedChannelIds = parseCommaList(allowedChannelsInput) ?? [];
	}

	const allowedUsersDefault = asStringArray(settings.allowedUserIds)?.join(", ") ?? "";
	const allowedUsersInput = (await ui.text({
		message: "Slack allowed user IDs (optional, comma-separated)",
		initialValue: allowedUsersDefault,
		placeholder: 'Type "none" to clear',
	})).trim();
	if (allowedUsersInput.toLowerCase() === "none") {
		delete settings.allowedUserIds;
	} else if (allowedUsersInput.length > 0) {
		settings.allowedUserIds = parseCommaList(allowedUsersInput) ?? [];
	}

	config.channels.slack = { enabled: true, settings };
}

async function configureWhatsApp(
	ui: ReturnType<typeof createWizardUi>,
	config: UnderstudyConfig,
) {
	const settings = asRecord(normalizeChannelConfig(config.channels.whatsapp).settings);
	const allowedDefault = asStringArray(settings.allowedNumbers)?.join(", ") ?? "";
	const allowedInput = (await ui.text({
		message: "WhatsApp allowed numbers (optional, comma-separated)",
		initialValue: allowedDefault,
		placeholder: 'Type "none" to clear',
	})).trim();
	if (allowedInput.toLowerCase() === "none") {
		delete settings.allowedNumbers;
	} else if (allowedInput.length > 0) {
		settings.allowedNumbers = parseCommaList(allowedInput) ?? [];
	}
	config.channels.whatsapp = { enabled: true, settings };
}

async function configureSignal(
	ui: ReturnType<typeof createWizardUi>,
	config: UnderstudyConfig,
	notices: string[],
) {
	const settings = asRecord(normalizeChannelConfig(config.channels.signal).settings);
	const senderInput = (await ui.text({
		message: "Signal sender/account",
		initialValue: asString(settings.sender),
		placeholder: "Leave blank to use SIGNAL_SENDER",
	})).trim();
	if (senderInput.length > 0) {
		settings.sender = senderInput;
	}
	if (!asString(settings.sender) && !process.env.SIGNAL_SENDER) {
		notices.push("Signal is enabled without a sender in config or environment.");
	}

	const cliPathInput = (await ui.text({
		message: "signal-cli path (optional)",
		initialValue: asString(settings.cliPath),
		placeholder: 'Type "none" to clear',
	})).trim();
	if (cliPathInput.toLowerCase() === "none") {
		delete settings.cliPath;
	} else if (cliPathInput.length > 0) {
		settings.cliPath = cliPathInput;
	}

	config.channels.signal = { enabled: true, settings };
}

async function configureLine(
	ui: ReturnType<typeof createWizardUi>,
	config: UnderstudyConfig,
	notices: string[],
) {
	const settings = asRecord(normalizeChannelConfig(config.channels.line).settings);
	const tokenInput = (await ui.text({
		message: "LINE channel access token",
		initialValue: asString(settings.channelAccessToken),
		placeholder: "Leave blank to use LINE_CHANNEL_ACCESS_TOKEN",
	})).trim();
	if (tokenInput.length > 0) {
		settings.channelAccessToken = tokenInput;
	}
	if (!asString(settings.channelAccessToken) && !process.env.LINE_CHANNEL_ACCESS_TOKEN) {
		notices.push("LINE is enabled without an access token in config or environment.");
	}

	const baseUrlInput = (await ui.text({
		message: "LINE API base URL (optional)",
		initialValue: asString(settings.apiBaseUrl),
		placeholder: 'Type "none" to clear',
	})).trim();
	if (baseUrlInput.toLowerCase() === "none") {
		delete settings.apiBaseUrl;
	} else if (baseUrlInput.length > 0) {
		settings.apiBaseUrl = baseUrlInput;
	}

	config.channels.line = { enabled: true, settings };
}

async function configureIMessage(
	ui: ReturnType<typeof createWizardUi>,
	config: UnderstudyConfig,
	notices: string[],
) {
	const settings = asRecord(normalizeChannelConfig(config.channels.imessage).settings);
	if (process.platform !== "darwin") {
		notices.push("iMessage only works on macOS.");
	}
	const serviceNameInput = (await ui.text({
		message: "Messages service name (optional)",
		initialValue: asString(settings.serviceName),
		placeholder: 'Type "none" to clear',
	})).trim();
	if (serviceNameInput.toLowerCase() === "none") {
		delete settings.serviceName;
	} else if (serviceNameInput.length > 0) {
		settings.serviceName = serviceNameInput;
	}
	config.channels.imessage = { enabled: true, settings };
}

async function configureSelectedChannels(params: {
	ui: ReturnType<typeof createWizardUi>;
	config: UnderstudyConfig;
	notices: string[];
}) {
	const availableChannels = new Set(listChannelFactories().filter((channelId) => channelId !== "web"));
	const orderedChannels = CHANNEL_CATALOG.filter((entry) => availableChannels.has(entry.id));
	const currentlyEnabled = buildEnabledChannelsList(params.config)
		.filter((channelId) => availableChannels.has(channelId));
	const wantsChannels = await params.ui.confirm({
		message: "Configure any chat channels now?",
		initialValue: currentlyEnabled.length > 0,
	});
	if (!wantsChannels) {
		return;
	}
	const selected = await params.ui.multiselect({
		message: "Select the chat channels you want to configure now (leave all unchecked to keep none enabled)",
		options: orderedChannels.map((entry) => ({
			value: entry.id,
			label: entry.label,
			hint: entry.hint,
		})),
		initialValues: currentlyEnabled,
		required: false,
	});

	for (const entry of orderedChannels) {
		if (!selected.includes(entry.id)) {
			const current = normalizeChannelConfig(params.config.channels[entry.id]);
			params.config.channels[entry.id] = {
				enabled: false,
				settings: current.settings,
			};
		}
	}

	for (const channelId of selected) {
		switch (channelId) {
			case "telegram":
				await configureTelegram(params.ui, params.config, params.notices);
				break;
			case "discord":
				await configureDiscord(params.ui, params.config, params.notices);
				break;
			case "slack":
				await configureSlack(params.ui, params.config, params.notices);
				break;
			case "whatsapp":
				await configureWhatsApp(params.ui, params.config);
				break;
			case "signal":
				await configureSignal(params.ui, params.config, params.notices);
				break;
			case "line":
				await configureLine(params.ui, params.config, params.notices);
				break;
			case "imessage":
				await configureIMessage(params.ui, params.config, params.notices);
				break;
			default:
				break;
		}
	}
}

async function reviewSetupChecklist(params: {
	ui: ReturnType<typeof createWizardUi>;
	config: UnderstudyConfig;
	notices: string[];
}) {
	let checklist = await collectSetupChecklist(params.config);
	await params.ui.note(formatSetupChecklist(checklist), "Setup Checklist");

	const actionable = checklist.filter((item) => item.status !== "ok" && item.openTarget);
	let openedAnySettings = false;
	for (const item of actionable) {
		const wantsOpen = await params.ui.confirm({
			message: `Open ${item.label} settings now?`,
			initialValue: true,
		});
		if (!wantsOpen || !item.openTarget) {
			continue;
		}
		const opened = await openExternalPath(item.openTarget);
		if (opened.ok) {
			openedAnySettings = true;
		} else {
			params.notices.push(`Could not open ${item.label} settings automatically.`);
		}
	}

	if (openedAnySettings) {
		const wantsRecheck = await params.ui.confirm({
			message: "Re-check GUI permissions and local tools now?",
			initialValue: true,
		});
		if (wantsRecheck) {
			checklist = await collectSetupChecklist(params.config);
			await params.ui.note(formatSetupChecklist(checklist), "Updated Checklist");
		}
	}
}

async function maybeInstallBackgroundService(params: {
	ui: ReturnType<typeof createWizardUi>;
	config: UnderstudyConfig;
}) {
	const wantsService = await params.ui.confirm({
		message: "Install the background gateway service on this machine?",
		initialValue: false,
	});
	if (!wantsService) {
		return;
	}
	await runDaemonCommand({
		installService: true,
		port: params.config.gateway?.port ?? 23333,
	});
}

function resolveSections(_mode: "quickstart"): SetupSection[] {
	return ["model", "browser", "memory", "channels", "permissions", "daemon"];
}

async function promptSetupMode(ui: ReturnType<typeof createWizardUi>): Promise<SetupMode> {
	return await ui.select({
		message: "Choose a setup flow",
		options: [
			{ value: "quickstart", label: "Quickstart", hint: "Recommended defaults plus browser and channel setup" },
			{ value: "advanced", label: "Advanced", hint: "Pick exactly which areas to configure" },
		],
		initialValue: "quickstart",
	});
}

async function promptAdvancedSections(
	ui: ReturnType<typeof createWizardUi>,
): Promise<SetupSection[]> {
	return await ui.multiselect({
		message: "Select the setup sections to run",
		options: ADVANCED_SECTION_OPTIONS,
		initialValues: ["model", "browser", "permissions", "channels"],
		required: true,
	});
}

export async function runWizardCommand(opts: WizardOptions = {}): Promise<void> {
	const configManager = await ConfigManager.load(opts.config);
	const next = cloneConfig(configManager.get());
	const configPath = configManager.getPath();
	const notices: string[] = [];

	if (opts.yes) {
		configManager.update(next);
		configManager.save();
		console.log(buildWizardSummary(configPath, next, notices));
		return;
	}

	const ui = createWizardUi();
	try {
		await ui.intro("Understudy Setup");
		await ui.note(buildCurrentConfigOverview(configPath, next), "Current Config");

		const mode = await promptSetupMode(ui);
		const sections = mode === "quickstart"
			? resolveSections(mode)
			: await promptAdvancedSections(ui);
		const advanced = mode === "advanced";

		if (sections.includes("model")) {
			await configureModelDefaults({
				ui,
				config: next,
				notices,
				advanced,
			});
		}
		if (sections.includes("browser")) {
			await configureBrowser({
				ui,
				config: next,
				notices,
			});
		}
		if (sections.includes("memory")) {
			await configureMemory({
				ui,
				config: next,
				advanced,
			});
		}
		if (sections.includes("channels")) {
			await configureSelectedChannels({
				ui,
				config: next,
				notices,
			});
		}
		if (sections.includes("permissions")) {
			await reviewSetupChecklist({
				ui,
				config: next,
				notices,
			});
		}

		configManager.update(next);
		configManager.save();

		if (sections.includes("daemon")) {
			await maybeInstallBackgroundService({
				ui,
				config: next,
			});
		}

		await ui.outro(buildWizardSummary(configPath, next, notices));
	} catch (error) {
		if (error instanceof WizardCancelledError) {
			return;
		}
		throw error;
	}
}
