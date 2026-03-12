import { describe, expect, it, vi } from "vitest";
import { UNDERSTUDY_BRAND, applyUnderstudyBranding, type InteractiveBrandingTarget } from "./chat-branding.js";

describe("applyUnderstudyBranding", () => {
	it("brands terminal title, header, and slash command descriptions", async () => {
		const terminalSetTitle = vi.fn();
		const header = {
			text: "pi v0.55.4\nCtrl+C to interrupt",
			setText(text: string) {
				this.text = text;
			},
		};
		const originalCheckForNewVersion = vi.fn(async () => "9.9.9");
		const showStatus = vi.fn();

		const mode: InteractiveBrandingTarget = {
			version: "0.55.4",
			builtInHeader: header,
			sessionManager: { getSessionName: () => "main" },
			ui: { terminal: { setTitle: terminalSetTitle } },
			showStatus,
			autocompleteProvider: {
				commands: [
					{ name: "quit", description: "Quit pi" },
					{ name: "settings", description: "Open pi settings menu" },
				],
			},
			init: async () => {},
			updateTerminalTitle: () => {},
			checkForNewVersion: originalCheckForNewVersion,
		};

		applyUnderstudyBranding(mode, { cliVersion: "0.1.0" });
		await mode.init?.();
		await expect(mode.checkForNewVersion?.()).resolves.toBeUndefined();

		mode.updateTerminalTitle?.();
		expect(terminalSetTitle).toHaveBeenCalled();
		const latestTitle = terminalSetTitle.mock.calls.at(-1)?.[0] as string | undefined;
		expect(latestTitle).toContain(`${UNDERSTUDY_BRAND} - main -`);
		expect(header.text.split("\n")[0]).toBe(`${UNDERSTUDY_BRAND} v0.1.0`);
		expect(header.text.split("\n")[1]).toBe("Type / for commands | Ctrl+C to interrupt");
		expect(mode.autocompleteProvider?.commands?.[0]?.description).toBe("Quit Understudy");
		expect(mode.autocompleteProvider?.commands?.[1]?.description).toBe("Open Understudy settings menu");
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "teach")?.description).toBe(
			"Usage: /teach start | stop | confirm [--validate] | validate | publish",
		);
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "browser-extension")?.description).toBe(
			"Usage: /browser-extension [managed|/path] to install the Chrome extension and wait for a tab handoff",
		);
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "attach")?.description).toBe(
			"Usage: /attach <path-or-url> for the next message",
		);
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "attachments")?.description).toBe(
			"Show queued files and images for the next message",
		);
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "detach")?.description).toBe(
			"Clear queued files and images for the next message",
		);
		expect(showStatus).toHaveBeenCalledWith(
			"Type / for commands. Common flows: /teach start, /attach <path>, /browser-extension, /quit.",
		);
		expect(originalCheckForNewVersion).not.toHaveBeenCalled();
	});

	it("sanitizes later upstream branding writes to terminal title and status surfaces", () => {
		const terminalSetTitle = vi.fn();
		const showStatus = vi.fn();
		const showError = vi.fn();
		const showWarning = vi.fn();
		const header = {
			text: "",
			setText(text: string) {
				this.text = text;
			},
		};

		const mode: InteractiveBrandingTarget = {
			builtInHeader: header,
			ui: { terminal: { setTitle: terminalSetTitle } },
			showStatus,
			showError,
			showWarning,
			updateTerminalTitle: () => {},
		};

		applyUnderstudyBranding(mode);

		mode.ui?.terminal?.setTitle?.("π - workspace");
		mode.showStatus?.("Quit pi and reopen @mariozechner/pi-coding-agent");
		mode.showError?.("pi startup failed");
		mode.showWarning?.("pi warning");
		mode.builtInHeader?.setText?.("pi v0.56.2");

		expect(terminalSetTitle).toHaveBeenLastCalledWith("Understudy - workspace");
		expect(showStatus).toHaveBeenLastCalledWith("Quit Understudy and reopen understudy");
		expect(showError).toHaveBeenLastCalledWith("Understudy startup failed");
		expect(showWarning).toHaveBeenLastCalledWith("Understudy warning");
		expect(header.text).toBe("Understudy v0.56.2");
	});

	it("re-applies slash command branding after autocomplete is rebuilt", () => {
		let mode: InteractiveBrandingTarget;
		const originalSetupAutocomplete = vi.fn(() => {
			mode.autocompleteProvider = {
				commands: [
					{ name: "quit", description: "Quit pi" },
					{ name: "reload", description: "Reload pi resources" },
				],
			};
		});

		mode = {
			autocompleteProvider: { commands: [] },
			setupAutocomplete: originalSetupAutocomplete,
			updateTerminalTitle: () => {},
		};

		applyUnderstudyBranding(mode);
		mode.setupAutocomplete?.("/tmp/fd");

		expect(originalSetupAutocomplete).toHaveBeenCalledOnce();
		expect(mode.autocompleteProvider?.commands?.[0]?.description).toBe("Quit Understudy");
		expect(mode.autocompleteProvider?.commands?.[1]?.description).toBe("Reload Understudy resources");
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "teach")?.description).toBe(
			"Usage: /teach start | stop | confirm [--validate] | validate | publish",
		);
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "browser-extension")?.description).toBe(
			"Usage: /browser-extension [managed|/path] to install the Chrome extension and wait for a tab handoff",
		);
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "attach")?.description).toBe(
			"Usage: /attach <path-or-url> for the next message",
		);
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "attachments")?.description).toBe(
			"Show queued files and images for the next message",
		);
		expect(mode.autocompleteProvider?.commands?.find((command) => command.name === "detach")?.description).toBe(
			"Clear queued files and images for the next message",
		);
	});

	it("sanitizes assistant directive tags in live events and restored chat messages", async () => {
		const handleEvent = vi.fn(async (_event: unknown) => {});
		const addMessageToChat = vi.fn();
		const mode: InteractiveBrandingTarget = {
			handleEvent,
			addMessageToChat,
		};

		applyUnderstudyBranding(mode);

		await mode.handleEvent?.({
			type: "message_end",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "[[reply_to_current]] Hi! [[audio_as_voice]]" }],
			},
		});
		mode.addMessageToChat?.({
			role: "assistant",
			content: [{ type: "text", text: "[[reply_to_current]] hello" }],
		});

		const firstEvent = handleEvent.mock.calls[0]?.[0] as any;
		const firstMessage = addMessageToChat.mock.calls[0]?.[0] as any;

		expect(firstEvent).toBeDefined();
		expect(firstMessage).toBeDefined();
		expect(firstEvent.message.content[0].text).toBe("Hi!");
		expect(firstMessage.content[0].text).toBe("hello");
	});
});
