/**
 * Completion command: generate shell completion scripts.
 */

interface CompletionOptions {
	shell?: string;
}

// Keep in sync with the commands registered in ../index.ts
const COMMANDS = [
	"chat", "config", "wizard", "status", "daemon", "gateway",
	"doctor", "health", "sessions", "logs", "models", "skills",
	"browser", "schedule", "reset", "channels", "pairing", "message",
	"agent", "agents", "security", "dashboard", "webchat", "completion",
];

export async function runCompletionCommand(opts: CompletionOptions = {}): Promise<void> {
	const shell = opts.shell ?? detectShell();

	switch (shell) {
		case "bash": {
			console.log(`# Understudy bash completion
# Add to ~/.bashrc: eval "$(understudy completion --shell bash)"
_understudy_completions() {
    local cur="\${COMP_WORDS[COMP_CWORD]}"
    COMPREPLY=( $(compgen -W "${COMMANDS.join(" ")}" -- "\${cur}") )
}
complete -F _understudy_completions understudy`);
			break;
		}
		case "zsh": {
			console.log(`# Understudy zsh completion
# Add to ~/.zshrc: eval "$(understudy completion --shell zsh)"
_understudy() {
    local -a commands
    commands=(${COMMANDS.map((c) => `'${c}'`).join(" ")})
    _describe 'commands' commands
}
compdef _understudy understudy`);
			break;
		}
		case "fish": {
			console.log(`# Understudy fish completion
# Save to ~/.config/fish/completions/understudy.fish`);
			for (const cmd of COMMANDS) {
				console.log(`complete -c understudy -n "__fish_use_subcommand" -a "${cmd}"`);
			}
			break;
		}
		case "powershell":
		case "pwsh": {
			console.log(`# Understudy PowerShell completion
# Save to your PowerShell profile and reload the shell.
Register-ArgumentCompleter -CommandName understudy -ScriptBlock {
    param($commandName, $wordToComplete, $cursorPosition)
    ${COMMANDS.map((cmd) => `'${cmd}'`).join(", ")} |
        Where-Object { $_ -like "$wordToComplete*" } |
        ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
}`);
			break;
		}
		default:
			console.error(`Unsupported shell: ${shell}. Use --shell bash|zsh|fish|powershell|pwsh`);
			process.exitCode = 1;
	}
}

function detectShell(): string {
	const shell = (process.env.SHELL ?? process.env.ComSpec ?? "").toLowerCase();
	if (shell.includes("pwsh")) return "pwsh";
	if (shell.includes("powershell")) return "powershell";
	if (shell.includes("zsh")) return "zsh";
	if (shell.includes("fish")) return "fish";
	if (process.platform === "win32") return "powershell";
	return "bash";
}
