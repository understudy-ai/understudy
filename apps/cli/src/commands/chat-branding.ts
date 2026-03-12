import { basename } from "node:path";
import { stripInlineDirectiveTagsForDisplay } from "@understudy/core";

export const UNDERSTUDY_BRAND = "Understudy";

const BRANDING_PATCH_FLAG = Symbol.for("understudy.chat.branding.applied");
const PI_WORD_PATTERN = /\bpi\b/gi;
const PI_GLYPH_PATTERN = /π/gu;
const PI_PACKAGE_PATTERN = /@mariozechner\/pi-coding-agent/gi;
const TEACH_COMMAND_NAME = "teach";
const TEACH_COMMAND_DESCRIPTION = "Usage: /teach start | stop | confirm [--validate] | validate | publish";
const BROWSER_EXTENSION_COMMAND_NAME = "browser-extension";
const BROWSER_EXTENSION_COMMAND_DESCRIPTION =
	"Usage: /browser-extension [managed|/path] to install the Chrome extension and wait for a tab handoff";
const ATTACH_COMMAND_NAME = "attach";
const ATTACH_COMMAND_DESCRIPTION = "Usage: /attach <path-or-url> for the next message";
const ATTACHMENTS_COMMAND_NAME = "attachments";
const ATTACHMENTS_COMMAND_DESCRIPTION = "Show queued files and images for the next message";
const DETACH_COMMAND_NAME = "detach";
const DETACH_COMMAND_DESCRIPTION = "Clear queued files and images for the next message";

type SlashCommandLike = {
	name?: string;
	value?: string;
	description?: string;
};

type AutocompleteProviderLike = {
	commands?: SlashCommandLike[];
};

type InteractiveEventLike = {
	message?: unknown;
} & Record<string, unknown>;

export type InteractiveBrandingTarget = {
	version?: string;
	builtInHeader?: { text?: string; setText?: (text: string) => void };
	sessionManager?: { getSessionName?: () => string | undefined };
	ui?: { terminal?: { setTitle?: (title: string) => void } };
	autocompleteProvider?: AutocompleteProviderLike;
	init?: (...args: unknown[]) => Promise<void>;
	setupAutocomplete?: (...args: unknown[]) => unknown;
	updateTerminalTitle?: () => void;
	checkForNewVersion?: () => Promise<string | undefined>;
	handleEvent?: (event: unknown) => Promise<void> | void;
	addMessageToChat?: (message: unknown, options?: unknown) => unknown;
	showStatus?: (text: string) => void;
	showError?: (text: string) => void;
	showWarning?: (text: string) => void;
};

export interface UnderstudyBrandingOptions {
	cliVersion?: string;
	disableVersionCheck?: boolean;
}

function resolveSlashCommandName(command: SlashCommandLike): string | undefined {
	if (typeof command.name === "string" && command.name.length > 0) {
		return command.name;
	}
	if (typeof command.value === "string" && command.value.length > 0) {
		return command.value;
	}
	return undefined;
}

function brandSlashDescription(commandName: string, description: string): string {
	if (commandName === "quit") {
		return `Quit ${UNDERSTUDY_BRAND}`;
	}
	return description.replace(PI_WORD_PATTERN, UNDERSTUDY_BRAND);
}

function patchSlashAutocompleteDescriptions(mode: InteractiveBrandingTarget): void {
	const commands = mode.autocompleteProvider?.commands;
	if (!Array.isArray(commands)) {
		return;
	}

	if (!commands.some((command) => resolveSlashCommandName(command) === TEACH_COMMAND_NAME)) {
		commands.push({
			name: TEACH_COMMAND_NAME,
			description: TEACH_COMMAND_DESCRIPTION,
		});
	}
	if (!commands.some((command) => resolveSlashCommandName(command) === BROWSER_EXTENSION_COMMAND_NAME)) {
		commands.push({
			name: BROWSER_EXTENSION_COMMAND_NAME,
			description: BROWSER_EXTENSION_COMMAND_DESCRIPTION,
		});
	}
	if (!commands.some((command) => resolveSlashCommandName(command) === ATTACH_COMMAND_NAME)) {
		commands.push({
			name: ATTACH_COMMAND_NAME,
			description: ATTACH_COMMAND_DESCRIPTION,
		});
	}
	if (!commands.some((command) => resolveSlashCommandName(command) === ATTACHMENTS_COMMAND_NAME)) {
		commands.push({
			name: ATTACHMENTS_COMMAND_NAME,
			description: ATTACHMENTS_COMMAND_DESCRIPTION,
		});
	}
	if (!commands.some((command) => resolveSlashCommandName(command) === DETACH_COMMAND_NAME)) {
		commands.push({
			name: DETACH_COMMAND_NAME,
			description: DETACH_COMMAND_DESCRIPTION,
		});
	}

	for (const command of commands) {
		if (!command || typeof command !== "object" || typeof command.description !== "string") {
			continue;
		}
		const commandName = resolveSlashCommandName(command);
		if (!commandName) {
			continue;
		}
		command.description = brandSlashDescription(commandName, command.description);
	}
}

function patchHeaderTitle(mode: InteractiveBrandingTarget, cliVersion?: string): void {
	const header = mode.builtInHeader;
	if (
		!header ||
		typeof header.setText !== "function" ||
		typeof header.text !== "string" ||
		header.text.length === 0
	) {
		return;
	}

	const version = cliVersion ?? mode.version;
	const brandedTitle = `${UNDERSTUDY_BRAND}${version ? ` v${version}` : ""}`;
	const lines = header.text.split("\n");
	const nextLines = [
		brandedTitle,
		"Type / for commands | Ctrl+C to interrupt",
		...lines.slice(2),
	];
	header.setText(nextLines.join("\n"));
}

function showStartupHint(mode: InteractiveBrandingTarget): void {
	if (typeof mode.showStatus !== "function") {
		return;
	}
	mode.showStatus(
		"Type / for commands. Common flows: /teach start, /attach <path>, /browser-extension, /quit.",
	);
}

function replaceVisibleRuntimeBranding(text: string): string {
	return text
		.replace(PI_PACKAGE_PATTERN, "understudy")
		.replace(PI_GLYPH_PATTERN, UNDERSTUDY_BRAND)
		.replace(PI_WORD_PATTERN, UNDERSTUDY_BRAND);
}

function sanitizeTextForDisplay(text: string): { text: string; changed: boolean } {
	const stripped = stripInlineDirectiveTagsForDisplay(text);
	const brandedText = replaceVisibleRuntimeBranding(stripped.text);
	return {
		text: brandedText,
		changed: stripped.changed || brandedText !== stripped.text,
	};
}

function sanitizeAssistantDisplayMessage(message: unknown): unknown {
	if (!message || typeof message !== "object") {
		return message;
	}
	const record = message as Record<string, unknown>;
	if (record.role !== "assistant") {
		return message;
	}
	let changed = false;
	const sanitized: Record<string, unknown> = { ...record };

	if (typeof sanitized.text === "string") {
		const text = sanitizeTextForDisplay(sanitized.text);
		if (text.changed) {
			sanitized.text = text.text;
			changed = true;
		}
	}

	if (Array.isArray(sanitized.content)) {
		const nextContent = sanitized.content.map((part) => {
			if (!part || typeof part !== "object") {
				return part;
			}
			const chunk = part as Record<string, unknown>;
			if (chunk.type !== "text" || typeof chunk.text !== "string") {
				return part;
			}
			const text = sanitizeTextForDisplay(chunk.text);
			if (!text.changed) {
				return part;
			}
			changed = true;
			return {
				...chunk,
				text: text.text,
			};
		});
		if (changed) {
			sanitized.content = nextContent;
		}
	} else if (typeof sanitized.content === "string") {
		const text = sanitizeTextForDisplay(sanitized.content);
		if (text.changed) {
			sanitized.content = text.text;
			changed = true;
		}
	}

	return changed ? sanitized : message;
}

function sanitizeInteractiveEvent(event: unknown): unknown {
	if (!event || typeof event !== "object") {
		return event;
	}
	const record = event as InteractiveEventLike;
	const sanitizedMessage = sanitizeAssistantDisplayMessage(record.message);
	if (sanitizedMessage === record.message) {
		return event;
	}
	return {
		...record,
		message: sanitizedMessage,
	};
}

export function applyUnderstudyBranding(
	mode: InteractiveBrandingTarget,
	options: UnderstudyBrandingOptions = {},
): void {
	const modeRecord = mode as Record<PropertyKey, unknown>;
	if (modeRecord[BRANDING_PATCH_FLAG]) {
		return;
	}
	modeRecord[BRANDING_PATCH_FLAG] = true;

	const originalUpdateTitle =
		typeof mode.updateTerminalTitle === "function"
			? mode.updateTerminalTitle.bind(mode)
			: undefined;
	const terminal = mode.ui?.terminal;
	const originalSetTerminalTitle =
		terminal && typeof terminal.setTitle === "function"
			? terminal.setTitle.bind(terminal)
			: undefined;

	if (terminal && originalSetTerminalTitle) {
		terminal.setTitle = (title: string) => originalSetTerminalTitle(replaceVisibleRuntimeBranding(title));
	}

	const header = mode.builtInHeader;
	const originalSetHeaderText =
		header && typeof header.setText === "function"
			? header.setText.bind(header)
			: undefined;

	if (header && originalSetHeaderText) {
		header.setText = (text: string) => {
			header.text = replaceVisibleRuntimeBranding(text);
			originalSetHeaderText(header.text);
		};
	}

	mode.updateTerminalTitle = () => {
		const cwdBasename = basename(process.cwd());
		const sessionName = mode.sessionManager?.getSessionName?.();
		const title = sessionName
			? `${UNDERSTUDY_BRAND} - ${sessionName} - ${cwdBasename}`
			: `${UNDERSTUDY_BRAND} - ${cwdBasename}`;

		if (mode.ui?.terminal?.setTitle) {
			mode.ui.terminal.setTitle(title);
			return;
		}
		originalUpdateTitle?.();
	};

	const originalShowStatus =
		typeof mode.showStatus === "function"
			? mode.showStatus.bind(mode)
			: undefined;
	if (originalShowStatus) {
		mode.showStatus = (text: string) => originalShowStatus(replaceVisibleRuntimeBranding(text));
	}

	const originalShowError =
		typeof mode.showError === "function"
			? mode.showError.bind(mode)
			: undefined;
	if (originalShowError) {
		mode.showError = (text: string) => originalShowError(replaceVisibleRuntimeBranding(text));
	}

	const originalShowWarning =
		typeof mode.showWarning === "function"
			? mode.showWarning.bind(mode)
			: undefined;
	if (originalShowWarning) {
		mode.showWarning = (text: string) => originalShowWarning(replaceVisibleRuntimeBranding(text));
	}

	const originalSetupAutocomplete =
		typeof mode.setupAutocomplete === "function"
			? mode.setupAutocomplete.bind(mode)
			: undefined;

	if (originalSetupAutocomplete) {
		mode.setupAutocomplete = (...args: unknown[]) => {
			const result = originalSetupAutocomplete(...args);
			patchSlashAutocompleteDescriptions(mode);
			return result;
		};
	}

	const originalHandleEvent =
		typeof mode.handleEvent === "function"
			? mode.handleEvent.bind(mode)
			: undefined;
	if (originalHandleEvent) {
		mode.handleEvent = (event: unknown) => originalHandleEvent(sanitizeInteractiveEvent(event));
	}

	const originalAddMessageToChat =
		typeof mode.addMessageToChat === "function"
			? mode.addMessageToChat.bind(mode)
			: undefined;
	if (originalAddMessageToChat) {
		mode.addMessageToChat = (message: unknown, messageOptions?: unknown) =>
			originalAddMessageToChat(sanitizeAssistantDisplayMessage(message), messageOptions);
	}

	if ((options.disableVersionCheck ?? true) && typeof mode.checkForNewVersion === "function") {
		mode.checkForNewVersion = async () => undefined;
	}

	const originalInit = typeof mode.init === "function" ? mode.init.bind(mode) : undefined;
	if (!originalInit) {
		patchSlashAutocompleteDescriptions(mode);
		return;
	}

	mode.init = async (...args: unknown[]) => {
		await originalInit(...args);
		patchHeaderTitle(mode, options.cliVersion);
		patchSlashAutocompleteDescriptions(mode);
		showStartupHint(mode);
		mode.updateTerminalTitle?.();
	};
}
