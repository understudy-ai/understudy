import { afterEach, describe, expect, it } from "vitest";
import { createExecTool } from "../exec-tool.js";
import { clearExecSessionsForTest } from "../openclaw-exec-sessions.js";
import { createProcessTool } from "../process-tool.js";

const nodeBin = JSON.stringify(process.execPath);

afterEach(() => {
	clearExecSessionsForTest();
});

describe("createExecTool", () => {
	it("runs short commands synchronously and returns the output", async () => {
		const tool = createExecTool();
		const result = await tool.execute("id", {
			command: `${nodeBin} -e "console.log('ready')"`,
			yieldMs: 2_000,
		});
		const text = (result.content[0] as { text: string }).text;

		expect(text).toContain("ready");
		expect(text).toContain("Process exited with code 0");
		expect(result.details).toMatchObject({
			status: "completed",
			exitCode: 0,
		});
	});

		it("backgrounds long-running commands and lets process poll the session", async () => {
			const execTool = createExecTool();
			const processTool = createProcessTool();
			const started = await execTool.execute("id", {
			command:
				`${nodeBin} -e "console.log('start'); setTimeout(() => console.log('done'), 60)"`,
			yieldMs: 1,
		});
		const sessionId = (started.details as { sessionId?: string }).sessionId;

		expect((started.details as { status?: string }).status).toBe("running");
		expect(sessionId).toBeTruthy();
		expect((started.content[0] as { text: string }).text).toContain("Background exec session started");

			const listed = await processTool.execute("id", { action: "list" });
			expect((listed.content[0] as { text: string }).text).toContain(String(sessionId));

			let polled = await processTool.execute("id", {
				action: "poll",
				sessionId,
				timeout: 1_000,
			});
			const seenPollTexts = [(polled.content[0] as { text: string }).text];
			for (let attempt = 0; attempt < 4 && (polled.details as { status?: string }).status === "running"; attempt += 1) {
				polled = await processTool.execute("id", {
					action: "poll",
					sessionId,
					timeout: 1_000,
				});
				seenPollTexts.push((polled.content[0] as { text: string }).text);
			}
			const pollText = (polled.content[0] as { text: string }).text;
			expect(pollText).toContain("Process exited with code 0");
			expect(polled.details).toMatchObject({
				status: "completed",
				sessionId,
			});
			const aggregated = String((polled.details as { aggregated?: string }).aggregated ?? "");
			expect([aggregated, ...seenPollTexts].join("\n")).toContain("done");
		});

	it("supports OpenClaw-style session writes and submit", async () => {
		const execTool = createExecTool();
		const processTool = createProcessTool();
		const started = await execTool.execute("id", {
			command:
				`${nodeBin} -e "process.stdin.setEncoding('utf8'); let data=''; process.stdin.on('data', (chunk) => { data += chunk; if (/[\\r\\n]/.test(data)) { console.log('ECHO:' + data.replace(/[\\r\\n]+/g, '')); process.exit(0); } });"`,
			background: true,
		});
		const sessionId = (started.details as { sessionId?: string }).sessionId;
		expect(sessionId).toBeTruthy();

		const write = await processTool.execute("id", {
			action: "write",
			sessionId,
			data: "hello",
		});
		expect((write.content[0] as { text: string }).text).toContain("Wrote 5 bytes");

		const submit = await processTool.execute("id", {
			action: "submit",
			sessionId,
		});
		expect((submit.content[0] as { text: string }).text).toContain("Submitted session");

			let polled = await processTool.execute("id", {
				action: "poll",
				sessionId,
				timeout: 1_000,
			});
			const seenPollTexts = [(polled.content[0] as { text: string }).text];
			for (let attempt = 0; attempt < 4 && (polled.details as { status?: string }).status === "running"; attempt += 1) {
				polled = await processTool.execute("id", {
					action: "poll",
					sessionId,
					timeout: 1_000,
				});
				seenPollTexts.push((polled.content[0] as { text: string }).text);
			}
			expect(polled.details).toMatchObject({
				status: "completed",
				sessionId,
			});
			const aggregated = String((polled.details as { aggregated?: string }).aggregated ?? "");
			expect([aggregated, ...seenPollTexts].join("\n")).toContain("ECHO:hello");
		});
	});
