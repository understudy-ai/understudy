import { afterEach, describe, expect, it, vi } from "vitest";
import { runCompletionCommand } from "./completion.js";

afterEach(() => {
	vi.restoreAllMocks();
	process.exitCode = 0;
});

describe("runCompletionCommand", () => {
	it("renders the current bash command surface into the completion script", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runCompletionCommand({ shell: "bash" });

		const output = String(log.mock.calls[0]?.[0]);
		expect(output).toContain(
			'compgen -W "chat config wizard status daemon gateway doctor health sessions logs models skills browser schedule reset channels pairing message agent agents security dashboard webchat completion"',
		);
	});

	it("emits one fish completion line per command", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runCompletionCommand({ shell: "fish" });

		const output = log.mock.calls.flat().join("\n");
		expect(output).toContain('complete -c understudy -n "__fish_use_subcommand" -a "browser"');
		expect(output).toContain('complete -c understudy -n "__fish_use_subcommand" -a "agents"');
		expect(output).toContain('complete -c understudy -n "__fish_use_subcommand" -a "completion"');
	});

	it("renders PowerShell completion", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runCompletionCommand({ shell: "powershell" });

		const output = String(log.mock.calls[0]?.[0]);
		expect(output).toContain("Register-ArgumentCompleter -CommandName understudy");
		expect(output).toContain("'gateway'");
		expect(output).toContain("'completion'");
	});

	it("rejects unsupported shells", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		await runCompletionCommand({ shell: "tcsh" });

		expect(error).toHaveBeenCalledWith("Unsupported shell: tcsh. Use --shell bash|zsh|fish|powershell|pwsh");
		expect(process.exitCode).toBe(1);
	});
});
