/**
 * Agent command: single-shot agent turn through the gateway.
 */

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { ImageContent } from "@mariozechner/pi-ai";
import { createRpcClient } from "../rpc-client.js";
import { mergeCliPromptText, prepareCliPromptInput } from "./cli-prompt-input.js";
import { resolveGatewayBrowserToken } from "./gateway-browser-auth.js";
import { buildGatewayConfigOverride } from "./model-support.js";

interface AgentOptions {
	message?: string;
	file?: string[];
	image?: string[];
	json?: boolean;
	port?: string;
	host?: string;
	timeout?: string;
	cwd?: string;
	model?: string;
	thinking?: string;
	config?: string;
	continue?: boolean;
}

type PrintableResult = {
	response?: string;
	images?: ImageContent[];
};

const CLI_GATEWAY_CHANNEL_ID = "cli";
const CLI_GATEWAY_SENDER_ID = "understudy-cli";

export async function runAgentCommand(opts: AgentOptions = {}): Promise<void> {
	if (!opts.message && !(opts.file?.length || opts.image?.length)) {
		console.error(
			"Usage: understudy agent --message 'What time is it?' [--file path] [--image path-or-url]",
		);
		process.exitCode = 1;
		return;
	}

	const parsedPort = opts.port ? parseInt(opts.port, 10) : undefined;
	const parsedTimeout = opts.timeout ? parseInt(opts.timeout, 10) : undefined;
	const defaultTimeout = parseInt(process.env.UNDERSTUDY_AGENT_TIMEOUT_MS ?? "600000", 10);
	const timeout =
		parsedTimeout && Number.isFinite(parsedTimeout) && parsedTimeout > 0
			? parsedTimeout
			: Number.isFinite(defaultTimeout) && defaultTimeout > 0
				? defaultTimeout
				: 600000;
	const cwd = resolve(opts.cwd ?? process.cwd());
	const promptInput = await prepareCliPromptInput({
		cwd,
		files: opts.file,
		images: opts.image,
	});
	const message = mergeCliPromptText(opts.message, promptInput);
	if (!message.trim()) {
		console.error(
			"Usage: understudy agent --message 'What time is it?' [--file path] [--image path-or-url]",
		);
		process.exitCode = 1;
		return;
	}

	const printResult = (result: PrintableResult): void => {
		if (opts.json) {
			console.log(JSON.stringify(result, null, 2));
		} else if (typeof result.response === "string" && result.response.length > 0) {
			console.log(result.response);
		} else if ((result.images?.length ?? 0) > 0) {
			const count = result.images?.length ?? 0;
			console.log(`(received ${count} image attachment${count === 1 ? "" : "s"})`);
		} else {
			console.log(result.response ?? "(no response)");
		}
	};

	try {
		const configOverride = buildGatewayConfigOverride(opts.model, opts.thinking);
		const token = await resolveGatewayBrowserToken(opts.config);
		const client = createRpcClient({
			host: opts.host,
			port: parsedPort,
			token,
			timeout,
		});
		const forceNew = opts.continue !== true;
		const executionScopeKey = forceNew ? randomUUID() : undefined;

		const startTimeout = Math.max(1_000, Math.min(timeout, 30_000));
		const started = await client.call<any>(
			"chat.send",
			{
				text: message,
				cwd,
				channelId: CLI_GATEWAY_CHANNEL_ID,
				senderId: CLI_GATEWAY_SENDER_ID,
				forceNew,
				...(executionScopeKey ? { executionScopeKey } : {}),
				waitForCompletion: false,
				...(configOverride ? { configOverride } : {}),
				...(promptInput.images?.length ? { images: promptInput.images } : {}),
			},
			{ timeout: startTimeout },
		);
		let result = started;

		if (started?.status === "in_flight" && typeof started?.runId === "string") {
			const deadline = Date.now() + timeout;
			for (;;) {
				const remainingMs = deadline - Date.now();
				if (remainingMs <= 0) {
					throw new Error(
						`Agent run timed out after ${timeout}ms (runId=${started.runId}, sessionId=${started.sessionId ?? "unknown"}).`,
					);
				}
				const waitTimeoutMs = Math.min(remainingMs, 30_000);
				const waitResult = await client.call<any>(
					"agent.wait",
					{
						runId: started.runId,
						sessionId: started.sessionId,
						timeoutMs: waitTimeoutMs,
					},
					{ timeout: waitTimeoutMs + 2_000 },
				);
				if (waitResult?.status === "timeout") {
					continue;
				}
				if (waitResult?.status === "error") {
					throw new Error(waitResult.error ?? "Agent run failed.");
				}
				if (waitResult?.status !== "ok") {
					throw new Error(`Unexpected agent.wait status: ${String(waitResult?.status ?? "unknown")}`);
				}
					result = {
						response: typeof waitResult.response === "string" ? waitResult.response : "",
						runId: waitResult.runId ?? started.runId,
						sessionId: waitResult.sessionId ?? started.sessionId,
						status: "ok",
						...(Array.isArray(waitResult.images) ? { images: waitResult.images } : {}),
						...(waitResult.meta ? { meta: waitResult.meta } : {}),
					};
				break;
			}
		}
		printResult(result);
		return;
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
