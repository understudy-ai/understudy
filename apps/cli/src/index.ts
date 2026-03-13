#!/usr/bin/env node

/**
 * Understudy CLI entry point.
 */

import { Command } from "commander";
import { ConfigManager, ensureRuntimeEngineAgentDirEnv, resolveUnderstudyAgentDir } from "@understudy/core";
import { loadUnderstudyPlugins } from "@understudy/plugins";
import { runChatCommand } from "./commands/chat.js";
import { runConfigCommand } from "./commands/config.js";
import { runDaemonCommand } from "./commands/daemon.js";
import { runGatewayCommand } from "./commands/gateway.js";
import { runWizardCommand } from "./commands/wizard.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runHealthCommand } from "./commands/health.js";
import { runSessionsCommand } from "./commands/sessions.js";
import { runLogsCommand } from "./commands/logs.js";
import { runModelsCommand } from "./commands/models.js";
import { runSkillsCommand } from "./commands/skills.js";
import { runResetCommand } from "./commands/reset.js";
import { runBrowserCommand } from "./commands/browser.js";
import { registerBrowserExtensionCommands } from "./commands/browser-extension.js";
import { runScheduleCommand } from "./commands/schedule.js";
import { runChannelsCommand } from "./commands/channels.js";
import { runPairingCommand } from "./commands/pairing.js";
import { registerMessageCommand } from "./commands/register-message-command.js";
import { runAgentCommand } from "./commands/agent.js";
import { runAgentsCommand } from "./commands/agents.js";
import { runSecurityCommand } from "./commands/security-cmd.js";
import { runDashboardCommand } from "./commands/dashboard.js";
import { runWebChatCommand } from "./commands/webchat.js";
import { runCompletionCommand } from "./commands/completion.js";
import { runStatusCommand } from "./commands/status.js";
import { collectRepeatValue } from "./commands/option-utils.js";

process.title = "understudy-cli";
ensureRuntimeEngineAgentDirEnv(resolveUnderstudyAgentDir());

const program = new Command();

function resolveConfigPathFromArgv(argv: string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const current = argv[index];
		if (current === "--config") {
			const next = argv[index + 1];
			return typeof next === "string" && next.trim().length > 0 ? next.trim() : undefined;
		}
		if (typeof current === "string" && current.startsWith("--config=")) {
			return current.slice("--config=".length).trim() || undefined;
		}
	}
	return undefined;
}

program
	.name("understudy")
	.description("Understudy — The teachable GUI agent runtime")
	.version("0.1.3");

program
	.command("chat")
	.description("Start an interactive terminal chat session")
	.option("-m, --model <model>", "Model to use (provider/model-id)")
	.option("-t, --thinking <level>", "Thinking level (off|minimal|low|medium|high|xhigh)")
	.option("-c, --cwd <dir>", "Working directory")
	.option("--message <text>", "Initial message to send on startup")
	.option("--file <path>", "Attach a local file as prompt context", collectRepeatValue, [])
	.option("--image <path-or-url>", "Attach an image from a local path or URL", collectRepeatValue, [])
	.option("--config <path>", "Config file path")
	.option("--continue", "Resume the most recent session")
	.action(runChatCommand);

program
	.command("tui")
	.description("Start an interactive terminal chat session")
	.option("-m, --model <model>", "Model to use (provider/model-id)")
	.option("-t, --thinking <level>", "Thinking level (off|minimal|low|medium|high|xhigh)")
	.option("-c, --cwd <dir>", "Working directory")
	.option("--message <text>", "Initial message to send on startup")
	.option("--file <path>", "Attach a local file as prompt context", collectRepeatValue, [])
	.option("--image <path-or-url>", "Attach an image from a local path or URL", collectRepeatValue, [])
	.option("--config <path>", "Config file path")
	.option("--continue", "Resume the most recent session")
	.action(runChatCommand);

program
	.command("config")
	.description("Manage Understudy configuration")
	.option("--show", "Show current configuration")
	.option("--set <key=value>", "Set a configuration value")
	.option("--path", "Show config file path")
	.option("--config <path>", "Config file path")
	.action(runConfigCommand);

program
	.command("wizard")
	.description("Run the guided setup flow for models, browser extension, GUI permissions, channels, and background service")
	.option("--config <path>", "Config file path")
	.option("-y, --yes", "Accept current defaults and save without prompts")
	.action(runWizardCommand);

program
	.command("status")
	.description("Show agent and gateway status")
	.option("--all", "Show extended status")
	.option("--json", "Output as JSON")
	.action(runStatusCommand);

program
	.command("daemon")
	.description("Manage background daemon")
	.option("--start", "Start the daemon")
	.option("--stop", "Stop the daemon")
	.option("--status", "Show daemon status")
	.option("--install-service", "Install and enable launchd/systemd user service")
	.option("--uninstall-service", "Disable and remove launchd/systemd user service")
	.option("--service-status", "Show launchd/systemd user service status")
	.option("-p, --port <port>", "Gateway port (default: 23333)", "23333")
	.action(runDaemonCommand);

program
	.command("gateway")
	.description("Start the gateway server (used by daemon)")
	.option("-p, --port <port>", "Gateway port", "23333")
	.option("--web-port <port>", "Optional port for the explicit web channel adapter (not WebChat)")
	.option("--host <host>", "Host to bind to", "127.0.0.1")
	.option("--config <path>", "Config file path")
	.action(runGatewayCommand);

program
	.command("doctor")
	.description("Run diagnostic checks on your Understudy installation")
	.option("--repair", "Attempt to fix issues")
	.option("--force", "Force repair without confirmation")
	.option("--deep", "Run additional deep checks")
	.action(runDoctorCommand);

program
	.command("health")
	.description("Show gateway health status")
	.option("--json", "Output as JSON")
	.option("--timeout <ms>", "Request timeout in ms")
	.option("-p, --port <port>", "Gateway port")
	.action(runHealthCommand);

program
	.command("sessions")
	.description("Manage agent sessions")
	.option("--list", "List all sessions")
	.option("--preview <id>", "Preview a session")
	.option("--reset <id>", "Reset a session")
	.option("--delete <id>", "Delete a session")
	.option("--compact <id>", "Compact a session")
	.option("--branch <id>", "Branch a session")
	.option("--fork-point <n>", "Fork message index for --branch")
	.option("--branch-id <id>", "Optional session id for the new branch")
	.option("--json", "Output as JSON")
	.option("-p, --port <port>", "Gateway port")
	.action(runSessionsCommand);

program
	.command("logs")
	.description("View daemon/gateway logs")
	.option("--tail <n>", "Show last N lines", "50")
	.option("--follow", "Follow log output")
	.option("--filter <pattern>", "Filter by regex pattern")
	.option("-p, --port <port>", "Gateway port")
	.action(runLogsCommand);

program
	.command("models")
	.description("List and manage available AI models")
	.option("--list", "List known models")
	.option("--scan", "Check which providers have usable auth configured")
	.option("--set <provider/model>", "Set default model")
	.action(runModelsCommand);

program
	.command("skills")
	.description("List, inspect, install, and uninstall skills")
	.option("--list", "List all skills")
	.option("--inspect <name>", "Show details of a skill")
	.option("--dir <path>", "Skills directory")
	.option("--config <path>", "Config file path")
	.option("--install <source>", "Install a skill from a .skill file, directory, URL, or git repo")
	.option("--uninstall <name>", "Uninstall a managed skill by name")
	.action(runSkillsCommand);

const browserCommand = program
	.command("browser")
	.description("Inspect and control the gateway browser runtime")
	.option("--status", "Show browser status")
	.option("--start", "Start the browser runtime")
	.option("--stop", "Stop the browser runtime")
	.option("--tabs", "List open tabs")
	.option("--open <url>", "Open a URL in a new tab")
	.option("--focus <targetId>", "Focus an existing tab")
	.option("--navigate <url>", "Navigate the active tab")
	.option("--screenshot", "Capture a screenshot")
	.option("--snapshot", "Capture a text snapshot")
	.option("--fn <code>", "Evaluate JavaScript in the active tab")
	.option("--close <targetId>", "Close a tab by target id")
	.option("--mode <mode>", "Browser connection mode: managed, extension, or auto")
	.option("--managed", "Use the built-in managed browser runtime")
	.option("--extension [cdpUrl]", "Use Chrome extension relay mode; optionally target an explicit relay URL")
	.option("--cdp-url <url>", "Explicit CDP URL for extension relay mode")
	.option("--json", "Output as JSON")
	.option("-p, --port <port>", "Gateway port")
	.option("--host <host>", "Gateway host")
	.action(runBrowserCommand);

registerBrowserExtensionCommands(browserCommand);

program
	.command("schedule")
	.description("Manage gateway schedule jobs")
	.option("--list", "List schedule jobs")
	.option("--status", "Show schedule runtime status")
	.option("--add", "Create a schedule job")
	.option("--update <id>", "Update a schedule job")
	.option("--remove <id>", "Remove a schedule job")
	.option("--run <id>", "Run a schedule job immediately")
	.option("--runs <id>", "Show recent runs for a schedule job")
	.option("--name <name>", "Job name")
	.option("--schedule <expr>", "Schedule expression (cron syntax)")
	.option("--command <command>", "Command/prompt to run")
	.option("--enable", "Enable the job on update")
	.option("--disable", "Disable the job on create/update")
	.option("--channel-id <id>", "Delivery channel id")
	.option("--sender-id <id>", "Delivery sender id")
	.option("--limit <n>", "Limit for --runs")
	.option("--json", "Output as JSON")
	.option("-p, --port <port>", "Gateway port")
	.option("--timeout <ms>", "RPC timeout in ms (default: 600000)")
	.action(runScheduleCommand);

program
	.command("reset")
	.description("Reset Understudy data")
	.option("--scope <scope>", "What to reset: config, sessions, memory, credentials, all")
	.option("--dry-run", "Preview what would be deleted")
	.option("--force", "Skip confirmation")
	.action(runResetCommand);

program
	.command("channels")
	.description("Manage gateway channels")
	.option("--list", "List channels")
	.option("--status <id>", "Show channel status")
	.option("--add <type>", "Add a channel (telegram, discord, slack, whatsapp, signal, line, imessage)")
	.option("--remove <id>", "Remove a channel")
	.option("--capabilities", "Show channel capabilities")
	.option("--json", "Output as JSON")
	.option("-p, --port <port>", "Gateway port")
	.action(runChannelsCommand);

program
	.command("pairing")
	.description("Manage channel pairing codes")
	.option("--approve <code>", "Approve a pairing code")
	.option("--reject <code>", "Reject a pairing code")
	.option("--channel <id>", "Channel ID for pairing")
	.option("-p, --port <port>", "Gateway port")
	.action(runPairingCommand);

registerMessageCommand(program);

program
	.command("agent")
	.description("Single-shot agent turn through the gateway")
	.option("--message <text>", "Message to send")
	.option("--file <path>", "Attach a local file as prompt context", collectRepeatValue, [])
	.option("--image <path-or-url>", "Attach an image from a local path or URL", collectRepeatValue, [])
	.option("--json", "Output as JSON")
	.option("-p, --port <port>", "Gateway port")
	.option("--host <host>", "Gateway host")
	.option("-c, --cwd <dir>", "Working directory to bind the run to")
	.option("-m, --model <model>", "Override the gateway session model (provider/model-id)")
	.option("-t, --thinking <level>", "Override the gateway session thinking level (off|minimal|low|medium|high|xhigh)")
	.option("--config <path>", "Config file path for gateway auth lookup")
	.option("--continue", "Resume the existing gateway-backed terminal session")
	.option("--timeout <ms>", "RPC timeout in ms (default: 600000)")
	.action(runAgentCommand);

program
	.command("agents")
	.description("List and manage configured agents")
	.option("--list", "List known agents")
	.option("--create <name>", "Create a new agent")
	.option("--update <id>", "Update an existing agent")
	.option("--delete <id>", "Delete an agent")
	.option("--workspace <path>", "Workspace path for create/update")
	.option("--model <provider/model>", "Default model for update")
	.option("--emoji <emoji>", "Identity emoji for create")
	.option("--avatar <avatar>", "Identity avatar or label for create/update")
	.option("--set-name <name>", "Updated display name")
	.option("--delete-files", "Delete workspace files when removing an agent")
	.option("--json", "Output as JSON")
	.option("-p, --port <port>", "Gateway port")
	.action(runAgentsCommand);

program
	.command("security")
	.description("Security audit and token management")
	.option("--audit", "Run security audit")
	.option("--generate-token", "Generate a gateway auth token")
	.option("--config <path>", "Config file path")
	.action(runSecurityCommand);

program
	.command("dashboard")
	.description("Open the control UI in your browser")
	.option("-p, --port <port>", "Gateway port")
	.option("--host <host>", "Gateway host")
	.option("--config <path>", "Config file path")
	.action(runDashboardCommand);

program
	.command("webchat")
	.description("Open the WebChat UI in your browser")
	.option("-p, --port <port>", "Gateway port")
	.option("--host <host>", "Gateway host")
	.option("--config <path>", "Config file path")
	.action(runWebChatCommand);

program
	.command("completion")
	.description("Generate shell completion scripts")
	.option("--shell <shell>", "Shell type: bash, zsh, fish")
	.action(runCompletionCommand);

// Default to chat if no command specified
program.action(runChatCommand);

async function applyCliPlugins(): Promise<void> {
	try {
		const configManager = await ConfigManager.load(resolveConfigPathFromArgv(process.argv.slice(2)));
		const registry = await loadUnderstudyPlugins({
			config: configManager.get(),
			configPath: configManager.getPath(),
			cwd: process.cwd(),
		});
		for (const registrar of registry.getCliRegistrars()) {
			await registrar(program);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[plugins] ${message}`);
	}
}

await applyCliPlugins();
await program.parseAsync(process.argv);
