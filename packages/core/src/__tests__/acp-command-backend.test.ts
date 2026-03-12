import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandAcpRuntimeBackend } from "../runtime/acp/command-backend.js";

describe("ACP command backend", () => {
	it("streams text output from an external ACP bridge command", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-acp-command-"));
		const scriptPath = join(dir, "bridge.mjs");
		await writeFile(
			scriptPath,
			[
				"let input = '';",
				"process.stdin.setEncoding('utf8');",
				"process.stdin.on('data', (chunk) => { input += chunk; });",
				"process.stdin.on('end', () => {",
				"  const payload = JSON.parse(input);",
				"  process.stdout.write(`external:${payload.prompt}`);",
				"});",
			].join("\n"),
			"utf8",
		);

		const backend = createCommandAcpRuntimeBackend({
			command: process.execPath,
			args: [scriptPath],
		});
		const handle = await backend.runtime.ensureSession({
			sessionKey: "s-acp-1",
			mode: "persistent",
			cwd: dir,
		});

		const events = [];
		for await (const event of backend.runtime.runTurn({
			handle,
			text: "hello",
			mode: "prompt",
			requestId: "req-1",
			messages: [],
			systemPrompt: "You are Understudy.",
		})) {
			events.push(event);
		}

		expect(events).toContainEqual({
			type: "text_delta",
			text: "external:hello",
			stream: "output",
		});
		expect(events[events.length - 1]).toEqual({
			type: "done",
			text: "external:hello",
		});
	});

	it("parses JSONL event streams into ACP runtime events", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-acp-command-jsonl-"));
		const scriptPath = join(dir, "bridge-jsonl.mjs");
		await writeFile(
			scriptPath,
			[
				"process.stdout.write(JSON.stringify({ type: 'status', text: 'warming up' }) + '\\n');",
				"process.stdout.write(JSON.stringify({ type: 'text_delta', text: 'partial', stream: 'output' }) + '\\n');",
				"process.stdout.write(JSON.stringify({ type: 'done', text: 'final text' }) + '\\n');",
			].join("\n"),
			"utf8",
		);

		const backend = createCommandAcpRuntimeBackend({
			command: process.execPath,
			args: [scriptPath],
			outputFormat: "jsonl",
		});
		const handle = await backend.runtime.ensureSession({
			sessionKey: "s-acp-jsonl",
			mode: "persistent",
			cwd: dir,
		});

		const events = [];
		for await (const event of backend.runtime.runTurn({
			handle,
			text: "hello",
			mode: "prompt",
			requestId: "req-jsonl-1",
			messages: [],
			systemPrompt: "You are Understudy.",
		})) {
			events.push(event);
		}

		expect(events).toEqual([
			{ type: "status", text: "warming up" },
			{ type: "text_delta", text: "partial", stream: "output" },
			{ type: "done", text: "final text" },
		]);
	});

	it("surfaces stderr from failed ACP bridge commands", async () => {
		const dir = await mkdtemp(join(tmpdir(), "understudy-acp-command-fail-"));
		const scriptPath = join(dir, "bridge-fail.mjs");
		await writeFile(
			scriptPath,
			[
				"console.error('bridge failed hard');",
				"process.exit(2);",
			].join("\n"),
			"utf8",
		);

		const backend = createCommandAcpRuntimeBackend({
			command: process.execPath,
			args: [scriptPath],
		});
		const handle = await backend.runtime.ensureSession({
			sessionKey: "s-acp-fail",
			mode: "persistent",
			cwd: dir,
		});

		const events = [];
		for await (const event of backend.runtime.runTurn({
			handle,
			text: "hello",
			mode: "prompt",
			requestId: "req-fail-1",
			messages: [],
			systemPrompt: "You are Understudy.",
		})) {
			events.push(event);
		}

		expect(events).toEqual([
			{
				type: "error",
				message: "bridge failed hard",
				code: "ACP_COMMAND_FAILED",
			},
		]);
	});
});
