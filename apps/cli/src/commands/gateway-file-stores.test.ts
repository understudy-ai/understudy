import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	FileGatewayRunTraceStore,
} from "./gateway-run-trace-store.js";
import {
	FileGatewayTranscriptStore,
	type GatewayTranscriptEntry,
} from "./gateway-transcript-store.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("gateway file stores", () => {
	it("serializes concurrent transcript appends per session", async () => {
		const baseDir = await createTempDir("understudy-gateway-transcript-store-");
		const store = new FileGatewayTranscriptStore(baseDir);
		const sessionId = "channel_sender-terminal-understudy-chat-ws_e0d24ce7bd98";
		const entries: GatewayTranscriptEntry[] = Array.from({ length: 40 }, (_, index) => ({
			sessionId,
			role: index % 2 === 0 ? "user" : "assistant",
			text: `entry-${index}`,
			timestamp: 1_773_100_000_000 + index,
		}));

		await Promise.all(entries.map((entry) => store.append(entry)));

		const persisted = await store.list({ sessionId, limit: 100 });
		expect(persisted).toHaveLength(entries.length);
		expect(new Set(persisted.map((entry) => entry.text))).toEqual(
			new Set(entries.map((entry) => entry.text)),
		);
	});

	it("preserves transcript media metadata", async () => {
		const baseDir = await createTempDir("understudy-gateway-transcript-media-store-");
		const store = new FileGatewayTranscriptStore(baseDir);
		const sessionId = "session-media";

		await store.append({
			sessionId,
			role: "user",
			text: "caption this",
			timestamp: 1_773_100_000_000,
			meta: {
				images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
				attachments: [{ type: "file", url: "upload://report.pdf", name: "report.pdf", mimeType: "application/pdf" }],
			},
		});

		const persisted = await store.list({ sessionId, limit: 10 });
		expect(persisted).toEqual([
			expect.objectContaining({
				role: "user",
				text: "caption this",
				meta: {
					images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
					attachments: [{ type: "file", url: "upload://report.pdf", name: "report.pdf", mimeType: "application/pdf" }],
				},
			}),
		]);
	});

	it("serializes concurrent run-trace appends per session", async () => {
		const baseDir = await createTempDir("understudy-gateway-run-trace-store-");
		const store = new FileGatewayRunTraceStore(baseDir);
		const sessionId = "channel_sender-terminal-understudy-chat-ws_e0d24ce7bd98";
		const traces = Array.from({ length: 30 }, (_, index) => ({
			runId: `run-${index}`,
			recordedAt: 1_773_100_000_000 + index,
			userPromptPreview: `prompt-${index}`,
			responsePreview: `response-${index}`,
			toolTrace: [],
			attempts: [],
		}));

		await Promise.all(traces.map((trace) => store.append({ sessionId, trace })));

		const persisted = await store.list({ sessionId, limit: 100 });
		expect(persisted).toHaveLength(traces.length);
		expect(new Set(persisted.map((trace) => trace.runId))).toEqual(
			new Set(traces.map((trace) => trace.runId)),
		);
	});
});
