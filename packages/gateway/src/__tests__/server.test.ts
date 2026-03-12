import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import vm from "node:vm";
import { GatewayServer } from "../server.js";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { Attachment, ChannelAdapter, ChannelMessagingAdapter, InboundMessage } from "@understudy/types";

function createMockChannel(id = "web"): ChannelAdapter & {
	emitInbound: (msg: InboundMessage) => void;
	sendMessageMock: ReturnType<typeof vi.fn>;
	editMessageMock: ReturnType<typeof vi.fn>;
	deleteMessageMock: ReturnType<typeof vi.fn>;
	reactToMessageMock: ReturnType<typeof vi.fn>;
} {
	let onMessageHandler: ((msg: InboundMessage) => void) | null = null;
	const sendMessageMock = vi.fn().mockResolvedValue("out_1");
	const editMessageMock = vi.fn().mockResolvedValue(undefined);
	const deleteMessageMock = vi.fn().mockResolvedValue(undefined);
	const reactToMessageMock = vi.fn().mockResolvedValue(undefined);

	const messaging: ChannelMessagingAdapter = {
		sendMessage: sendMessageMock,
		editMessage: editMessageMock,
		deleteMessage: deleteMessageMock,
		reactToMessage: reactToMessageMock,
		onMessage: (handler) => {
			onMessageHandler = handler;
			return () => {
				onMessageHandler = null;
			};
		},
	};

	return {
		id,
		name: `mock-${id}`,
		capabilities: {
			streaming: false,
			threads: true,
			reactions: true,
			attachments: true,
			groups: false,
		},
		messaging,
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		emitInbound: (msg) => onMessageHandler?.(msg),
		sendMessageMock,
		editMessageMock,
		deleteMessageMock,
		reactToMessageMock,
	};
}

async function jsonFetch(url: string, init?: RequestInit): Promise<any> {
	const res = await fetch(url, init);
	const body = await res.json();
	return { status: res.status, body };
}

function gatewayPort(gateway: GatewayServer): number {
	const addr = (gateway as any).server.address();
	if (!addr || typeof addr === "string") {
		throw new Error("Gateway server is not listening on a TCP port");
	}
	return addr.port;
}

function assertInlineScriptsCompile(html: string, label: string): void {
	const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/g) ?? [];
	for (const [index, scriptTag] of scriptMatches.entries()) {
		const source = scriptTag
			.replace(/^<script>/, "")
			.replace(/<\/script>$/, "");
		expect(() => new vm.Script(source, { filename: `${label}-${index + 1}.js` })).not.toThrow();
	}
}

function waitForEvent(ws: WebSocket, predicate: (data: any) => boolean, timeoutMs = 3000): Promise<any> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for ws event"));
		}, timeoutMs);

		const onMessage = (raw: WebSocket.RawData) => {
			try {
				const data = JSON.parse(raw.toString());
				if (predicate(data)) {
					cleanup();
					resolve(data);
				}
			} catch {
				// ignore malformed frames
			}
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const cleanup = () => {
			clearTimeout(timeout);
			ws.off("message", onMessage);
			ws.off("error", onError);
		};

		ws.on("message", onMessage);
		ws.on("error", onError);
	});
}

async function waitForAssertion(assertion: () => void, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			assertion();
			return;
		} catch (error) {
			if (Date.now() >= deadline) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
}

describe("GatewayServer", () => {
	let gateway: GatewayServer | null = null;

	afterEach(async () => {
		if (gateway) {
			await gateway.stop();
			gateway = null;
		}
	});

	it("serves health/channels/dashboard/webchat and pairing HTTP endpoints", async () => {
		const channel = createMockChannel("web");
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.addChannel(channel);
		await gateway.start();
		const port = gatewayPort(gateway);
		const base = `http://127.0.0.1:${port}`;

		const health = await jsonFetch(`${base}/health`);
		expect(health.status).toBe(200);
		expect(health.body.status).toBe("ok");
		expect(health.body.channels).toContain("web");

		const channels = await jsonFetch(`${base}/channels`);
		expect(channels.status).toBe(200);
		expect(channels.body.channels[0]).toMatchObject({
			id: "web",
			name: "mock-web",
			runtime: { state: "running" },
		});

		const rootRes = await fetch(`${base}/`, { redirect: "manual" });
		expect(rootRes.status).toBe(302);
		expect(rootRes.headers.get("location")).toBe("/webchat");

		const dashboardRes = await fetch(`${base}/ui`);
		expect(dashboardRes.status).toBe(200);
		const dashboardHtml = await dashboardRes.text();
		expect(dashboardHtml).toContain("Understudy Dashboard");
		expect(dashboardHtml).toContain("Overview");
		expect(dashboardHtml).toContain("Configuration");
		expect(dashboardHtml).toContain("Runtime Readiness");
		expect(dashboardHtml).toContain("Channel Operations");
		expect(dashboardHtml).toContain("Execution Trace");
		expect(dashboardHtml).toContain("Teach by Demonstration");
		expect(dashboardHtml).toContain("/teach start");
		assertInlineScriptsCompile(dashboardHtml, "control-ui");

		const webchatRes = await fetch(`${base}/webchat`);
		expect(webchatRes.status).toBe(200);
		const html = await webchatRes.text();
		expect(html).toContain("Understudy WebChat");
		expect(html).toContain("Send a message to start a conversation.");
		expect(html).toContain("click the model badge above to switch models");
		expect(html).toContain("Message Understudy... (/ for commands)");
		expect(html).toContain("Enter to send, Shift+Enter for new line, / for commands, click Model to switch");
		expect(html).toContain("/channels");
		expect(html).toContain("run-card");
		expect(html).toContain('type === "status_change"');
		expect(html).toContain('data.stream === "thought"');
		expect(html).toContain("const BASE = location.origin;");
		expect(html).toContain('new WebSocket(url.toString())');
		expect(html).toContain('url.searchParams.set("token", token)');
		expect(html).toContain('id="attach-btn"');
		expect(html).toContain("event.toolCallId");
		expect(html).toContain("session-chip-row");
		expect(html).toContain("function renderSessionBadgeRow");
		expect(html).not.toContain("event.callId");
		assertInlineScriptsCompile(html, "webchat");

		const badPair = await jsonFetch(`${base}/pairing/request`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(badPair.status).toBe(400);

		const pairReq = await jsonFetch(`${base}/pairing/request`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ channelId: "web" }),
		});
		expect(pairReq.status).toBe(200);
		expect(typeof pairReq.body.code).toBe("string");

		const allowed = await jsonFetch(`${base}/pairing/allowed/web`);
		expect(allowed.status).toBe(200);
		expect(Array.isArray(allowed.body.allowed)).toBe(true);
	});

	it("does not embed the configured auth token into the public webchat html", async () => {
		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			auth: { mode: "token", token: 'secret"token</script>' },
		});
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const webchatRes = await fetch(`${base}/webchat`);
		expect(webchatRes.status).toBe(200);
		const html = await webchatRes.text();
		expect(html).not.toContain('secret"token</script>');
	});

	it("renders rpc-view for ad-hoc task and session inspection", async () => {
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.setSessionHandlers({
			list: async () => [],
			get: async (params) => ({ id: params?.sessionId ?? "s1", messageCount: 3 }),
			trace: async (params) => ({
				sessionId: params?.sessionId ?? "s1",
				runs: [{ runId: "run-1", responsePreview: "done" }],
			}),
		});
		gateway.registerRpcHandler("tasks.get", async (request) => ({
			id: request.id,
			result: { id: request.params.taskId ?? "task-1", status: "completed" },
		}));
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const taskView = await fetch(`${base}/rpc-view?method=tasks.get&taskId=task-1`);
		expect(taskView.status).toBe(200);
		expect(await taskView.text()).toContain('"status": "completed"');

		const sessionView = await fetch(`${base}/rpc-view?method=session.get&sessionId=s1`);
		expect(sessionView.status).toBe(200);
		expect(await sessionView.text()).toContain('"messageCount": 3');

		const traceView = await fetch(`${base}/rpc-view?method=session.trace&sessionId=s1`);
		expect(traceView.status).toBe(200);
		expect(await traceView.text()).toContain('"runId": "run-1"');
	});

	it("handles RPC methods including chat and pairing", async () => {
		const channel = createMockChannel("web");
		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			healthHandlers: {
				getReadiness: async () => ({
					ok: true,
					checks: [{ id: "browser", status: "ready" }],
				}),
			},
		});
		gateway.addChannel(channel);
		gateway.setChatHandler(async (text) => (
			text === "with-run"
				? {
					response: `[[reply_to_current]] Echo:${text} [[audio_as_voice]]`,
					runId: "run_test",
					sessionId: "s1",
					meta: { durationMs: 42 },
				}
				: text === "tagged"
					? `[[reply_to_current]] Echo:${text}`
					: `Echo:${text}`
		));
				gateway.setSessionHandlers({
					list: async () => [{ id: "s1" }],
					get: async () => ({ id: "s1", messageCount: 3 }),
					history: async () => ({
					sessionId: "s1",
					messages: [
						{ role: "user", text: "[[reply_to_current]] hello" },
						{ role: "assistant", text: "[[reply_to_current]] world" },
						{
							role: "assistant",
							content: [{ type: "text", text: "[[reply_to:abc-123]] block" }],
						},
					],
					}),
					teachList: async () => ({ drafts: [{ id: "draft-1" }] }),
					teachCreate: async () => ({ id: "draft-1", sessionId: "s1", status: "validated" }),
					teachValidate: async () => ({ sessionId: "s1", draft: { id: "draft-1", validation: { state: "validated" } } }),
					teachPublish: async () => ({ draft: { id: "draft-1", status: "published" }, skill: { name: "draft-1-skill" } }),
					teachRecordStatus: async () => ({ sessionId: "s1", recording: null }),
					create: async () => ({ id: "s2", createdAt: Date.now() }),
					send: async () => ({ sessionId: "s1", response: "[[reply_to_current]] ok" }),
					branch: async () => ({ id: "s1b", parentId: "s1", forkPoint: 2 }),
					spawnSubagent: async () => ({
						status: "in_flight",
						parentSessionId: "s1",
						childSessionId: "s1:subagent:1",
						sessionId: "s1:subagent:1",
						runId: "run-sub-1",
					}),
					subagents: async (params) => ({
						parentSessionId: "s1",
						action: params?.action ?? "list",
						subagents: [{ sessionId: "s1:subagent:1", latestRunStatus: "in_flight" }],
					}),
					abort: async () => ({ aborted: true, sessionId: "s1" }),
				});
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const rpc = async (payload: any) =>
			jsonFetch(`${base}/rpc`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			});

		const readiness = await rpc({ id: "1a", method: "runtime.readiness", params: {} });
		expect(readiness.body.result).toMatchObject({
			ok: true,
			checks: [{ id: "browser", status: "ready" }],
		});

		const chatBad = await rpc({ id: "2", method: "chat.send", params: {} });
		expect(chatBad.body.error).toMatchObject({ code: 400 });

		const chatGood = await rpc({ id: "3", method: "chat.send", params: { text: "hello" } });
		expect(chatGood.body.result.response).toBe("Echo:hello");

		const chatTagged = await rpc({ id: "3a", method: "chat.send", params: { text: "tagged" } });
		expect(chatTagged.body.result.response).toBe("Echo:tagged");
		expect(chatTagged.body.result.replyToCurrent).toBe(true);

		const chatWithRun = await rpc({ id: "3b", method: "chat.send", params: { text: "with-run" } });
		expect(chatWithRun.body.result).toMatchObject({
			response: "Echo:with-run",
			runId: "run_test",
			sessionId: "s1",
			meta: { durationMs: 42 },
		});

		const stream = await rpc({ id: "4", method: "chat.stream", params: { text: "stream" } });
		expect(stream.body.result.response).toBe("Echo:stream");

		const abort = await rpc({ id: "4b", method: "chat.abort", params: { sessionId: "s1" } });
		expect(abort.body.result).toMatchObject({ aborted: true, sessionId: "s1" });

		const channelList = await rpc({ id: "5", method: "channel.list", params: {} });
		expect(channelList.body.result[0]).toMatchObject({ id: "web" });

		const channelStatus = await rpc({ id: "5b", method: "channel.status", params: { channelId: "web" } });
		expect(channelStatus.body.result).toMatchObject({
			id: "web",
			runtime: { state: "running" },
		});

		const sessionList = await rpc({ id: "5c", method: "session.list", params: {} });
		expect(sessionList.body.result[0]).toMatchObject({ id: "s1" });

		const sessionGet = await rpc({ id: "5d", method: "session.get", params: { sessionId: "s1" } });
		expect(sessionGet.body.result).toMatchObject({ id: "s1", messageCount: 3 });

		const sessionHistory = await rpc({ id: "5e", method: "session.history", params: { sessionId: "s1" } });
		expect(sessionHistory.body.result).toMatchObject({
			sessionId: "s1",
			messages: [
				{ role: "user", text: "[[reply_to_current]] hello" },
				{ role: "assistant", text: "world" },
				{ role: "assistant", content: [{ type: "text", text: "block" }] },
			],
		});

		const sessionCreate = await rpc({ id: "5f", method: "session.create", params: { channelId: "web", senderId: "u1" } });
		expect(sessionCreate.body.result.id).toBe("s2");

		const sessionSend = await rpc({ id: "5g", method: "session.send", params: { sessionId: "s1", message: "ping" } });
		expect(sessionSend.body.result).toMatchObject({ sessionId: "s1", response: "ok" });

			const sessionLookup = await rpc({ id: "5h", method: "session.get", params: { sessionId: "s1" } });
			expect(sessionLookup.body.result).toMatchObject({ id: "s1", messageCount: 3 });

			const sessionTeachList = await rpc({ id: "5h0", method: "session.teach.list", params: { sessionId: "s1" } });
			expect(sessionTeachList.body.result).toMatchObject({ drafts: [{ id: "draft-1" }] });

			const sessionTeachCreate = await rpc({ id: "5h1", method: "session.teach.create", params: { sessionId: "s1" } });
			expect(sessionTeachCreate.body.result).toMatchObject({ id: "draft-1", sessionId: "s1" });

			const sessionTeachValidate = await rpc({ id: "5h1a", method: "session.teach.validate", params: { sessionId: "s1", draftId: "draft-1" } });
			expect(sessionTeachValidate.body.result).toMatchObject({ sessionId: "s1", draft: { id: "draft-1" } });

			const sessionTeachPublish = await rpc({ id: "5h1b", method: "session.teach.publish", params: { sessionId: "s1", draftId: "draft-1" } });
			expect(sessionTeachPublish.body.result).toMatchObject({ draft: { id: "draft-1", status: "published" } });

			const sessionBranch = await rpc({ id: "5h2", method: "session.branch", params: { sessionId: "s1", forkPoint: 2 } });
			expect(sessionBranch.body.result).toMatchObject({ id: "s1b", parentId: "s1", forkPoint: 2 });

			const sessionsSpawn = await rpc({
				id: "5h3",
				method: "sessions.spawn",
				params: { parentSessionId: "s1", task: "delegate work" },
			});
			expect(sessionsSpawn.body.result).toMatchObject({
				status: "in_flight",
				parentSessionId: "s1",
				childSessionId: "s1:subagent:1",
				runId: "run-sub-1",
			});

			const subagents = await rpc({
				id: "5h4",
				method: "subagents",
				params: { parentSessionId: "s1", action: "list" },
			});
			expect(subagents.body.result).toMatchObject({
				parentSessionId: "s1",
				subagents: [{ sessionId: "s1:subagent:1", latestRunStatus: "in_flight" }],
			});

		const pairReq = await rpc({ id: "6", method: "pairing.request", params: { channelId: "web" } });
		const code = pairReq.body.result.code;
		expect(typeof code).toBe("string");

		const approve = await rpc({ id: "7", method: "pairing.approve", params: { code, channelId: "web", senderId: "u1" } });
		expect(approve.body.result.approved).toBe(true);

		const missing = await rpc({ id: "8", method: "pairing.request", params: {} });
		expect(missing.body.error).toMatchObject({ code: 400 });

		const retiredLegacyMethods = [
			{ id: "8b2", method: "connect.challenge", params: {} },
			{ id: "8b2x", method: "push.test", params: {} },
			{ id: "8b3", method: "tts.status", params: {} },
			{ id: "8b4", method: "voicewake.get", params: {} },
			{ id: "8b5", method: "device.pair.list", params: {} },
			{ id: "8b6", method: "doctor.memory.status", params: {} },
			{ id: "8b7", method: "update.run", params: {} },
			{ id: "8b8", method: "node.list", params: {} },
			{ id: "8b9", method: "wizard.start", params: {} },
			{ id: "8ba", method: "talk.mode", params: {} },
			{ id: "8bc", method: "sessions.usage.logs", params: { sessionId: "s1" } },
			{ id: "8bd", method: "send", params: { channelId: "web", to: "u1", text: "hello" } },
			{ id: "8be", method: "channels.status", params: { channelId: "web" } },
			{ id: "8bf", method: "channels.logout", params: { channelId: "web" } },
			{ id: "8bg", method: "sessions.preview", params: { sessionId: "s1" } },
			{ id: "8bh", method: "sessions.resolve", params: { sessionId: "s1" } },
			{ id: "8bi", method: "sessions.usage", params: { sessionId: "s1" } },
			{ id: "8bj", method: "sessions.usage.timeseries", params: { sessionId: "s1" } },
		];
		for (const testCase of retiredLegacyMethods) {
			const response = await rpc(testCase);
			expect(response.body.error).toMatchObject({ code: 404 });
		}

		const unknown = await rpc({ id: "9", method: "not.real", params: {} });
		expect(unknown.body.error).toMatchObject({ code: 404 });
	});

	it("reports capability inventory, namespaces, groups, and transport details", async () => {
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.registerRpcHandler("tasks.get", async (request) => ({
			id: request.id,
			result: { id: request.params.taskId ?? "task-1" },
		}));
		await gateway.start();
		const port = gatewayPort(gateway);
		const base = `http://127.0.0.1:${port}`;

		const response = await jsonFetch(`${base}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "cap_1",
				method: "capabilities.get",
				params: {},
			}),
		});

		expect(response.status).toBe(200);
		expect(response.body.result).toMatchObject({
			schemaVersion: 1,
			inventory: {
				methods: expect.arrayContaining([
					expect.objectContaining({ name: "capabilities.get", namespace: "capabilities", group: "capabilities" }),
					expect.objectContaining({ name: "health", namespace: "core", group: "core" }),
					expect.objectContaining({ name: "tasks.get", namespace: "tasks", group: "tasks" }),
				]),
				namespaces: expect.arrayContaining([
					expect.objectContaining({
						name: "core",
						methods: expect.arrayContaining(["health"]),
					}),
					expect.objectContaining({
						name: "tasks",
						groups: ["tasks"],
						methods: ["tasks.get"],
					}),
				]),
				groups: expect.arrayContaining([
					expect.objectContaining({
						name: "capabilities",
						namespace: "capabilities",
						methods: ["capabilities.get"],
					}),
					expect.objectContaining({
						name: "tasks",
						namespace: "tasks",
						methods: ["tasks.get"],
					}),
				]),
			},
			transport: {
				http: {
					enabled: true,
					host: "127.0.0.1",
					port,
					auth: { mode: "none", required: false },
					routes: {
						rpc: "/rpc",
						rpcView: "/rpc-view",
						health: "/health",
						chat: "/chat",
						channels: "/channels",
					},
				},
				websocket: {
					enabled: true,
					host: "127.0.0.1",
					port,
					path: "/",
					sharedPort: true,
					auth: { mode: "none", required: false },
				},
			},
		});
		expect(typeof response.body.result.generatedAt).toBe("number");
	});

	it("merges capabilities.get callback discovery into the default surface", async () => {
		const capabilitiesGet = vi.fn(async ({ request, defaults }: any) => ({
			runtime: {
				requestId: request.id,
				methodCount: defaults.inventory.methods.length,
			},
			transport: {
				websocket: {
					path: "/rpc/ws",
				},
			},
		}));

		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			capabilitiesGet,
		});
		await gateway.start();
		const port = gatewayPort(gateway);
		const base = `http://127.0.0.1:${port}`;

		const response = await jsonFetch(`${base}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "cap_2",
				method: "capabilities.get",
				params: {},
			}),
		});

		expect(response.status).toBe(200);
		expect(capabilitiesGet).toHaveBeenCalledWith(expect.objectContaining({
			request: expect.objectContaining({ id: "cap_2", method: "capabilities.get" }),
			defaults: expect.objectContaining({
				inventory: expect.objectContaining({
					methods: expect.arrayContaining([
						expect.objectContaining({ name: "capabilities.get" }),
					]),
				}),
			}),
		}));
		expect(response.body.result).toMatchObject({
			runtime: {
				requestId: "cap_2",
			},
			transport: {
				http: {
					routes: {
						rpc: "/rpc",
					},
				},
				websocket: {
					path: "/rpc/ws",
					sharedPort: true,
				},
			},
		});
	});

	it("forces chat.stream requests into async mode", async () => {
		let observedContext: Record<string, unknown> | undefined;
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.setChatHandler(async (_text, context) => {
			observedContext = (context ?? {}) as Record<string, unknown>;
			return {
				response: "",
				runId: "run_stream",
				sessionId: "session_stream",
				status: "in_flight",
			};
		});
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const response = await jsonFetch(`${base}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "stream_1",
				method: "chat.stream",
				params: {
					text: "stream please",
					waitForCompletion: true,
				},
			}),
		});

		expect(response.body.result).toMatchObject({
			runId: "run_stream",
			sessionId: "session_stream",
			status: "in_flight",
		});
		expect(observedContext).toMatchObject({
			waitForCompletion: false,
		});
	});

	it("forwards per-turn session controls through chat RPC methods", async () => {
		const observedCalls: Array<{ text: string; context: Record<string, unknown> }> = [];
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.setChatHandler(async (text, context) => {
			observedCalls.push({
				text,
				context: (context ?? {}) as Record<string, unknown>,
			});
			return {
				response: `ok:${text}`,
				sessionId: "session_controls",
			};
		});
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const rpc = async (payload: any) =>
			jsonFetch(`${base}/rpc`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			});

		const sendConfigOverride = {
			model: "gpt-5.4",
			agent: { thinkingLevel: "medium" },
		};
		const sendSandboxInfo = {
			enabled: true,
			workspaceDir: "/tmp/send-sandbox",
			workspaceAccess: "workspace-write",
		};
		const sendResponse = await rpc({
			id: "controls_send",
			method: "chat.send",
			params: {
				text: "send controls",
				channelId: "cli",
				senderId: "user_1",
				conversationType: "thread",
				threadId: "thread_1",
				cwd: "/tmp/send",
				forceNew: true,
				configOverride: sendConfigOverride,
				sandboxInfo: sendSandboxInfo,
				executionScopeKey: "scope:send",
				waitForCompletion: true,
			},
		});

		expect(sendResponse.body.result).toMatchObject({
			response: "ok:send controls",
			sessionId: "session_controls",
		});
		expect(observedCalls[0]).toMatchObject({
			text: "send controls",
			context: {
				channelId: "cli",
				senderId: "user_1",
				conversationType: "thread",
				threadId: "thread_1",
				cwd: "/tmp/send",
				forceNew: true,
				configOverride: sendConfigOverride,
				sandboxInfo: sendSandboxInfo,
				executionScopeKey: "scope:send",
				waitForCompletion: true,
			},
		});

		const streamConfigOverride = {
			model: "gpt-5.4",
			defaults: { profile: "gateway" },
		};
		const streamSandboxInfo = {
			enabled: false,
			containerWorkspaceDir: "/workspace/container",
		};
		const streamResponse = await rpc({
			id: "controls_stream",
			method: "chat.stream",
			params: {
				text: "stream controls",
				channelId: "cli",
				senderId: "user_2",
				conversationType: "direct",
				threadId: "thread_2",
				cwd: "/tmp/stream",
				forceNew: false,
				configOverride: streamConfigOverride,
				sandboxInfo: streamSandboxInfo,
				executionScopeKey: "scope:stream",
				waitForCompletion: true,
			},
		});

		expect(streamResponse.body.result).toMatchObject({
			response: "ok:stream controls",
			sessionId: "session_controls",
		});
		expect(observedCalls[1]).toMatchObject({
			text: "stream controls",
			context: {
				channelId: "cli",
				senderId: "user_2",
				conversationType: "direct",
				threadId: "thread_2",
				cwd: "/tmp/stream",
				forceNew: false,
				configOverride: streamConfigOverride,
				sandboxInfo: streamSandboxInfo,
				executionScopeKey: "scope:stream",
				waitForCompletion: false,
			},
		});
	});

	it("passes media through RPC, HTTP, and inbound channel chat entrypoints", async () => {
		const channel = createMockChannel("web");
		const chatHandler = vi.fn(async (_text: string, context?: any) => ({
			response: `images=${context?.images?.length ?? 0};attachments=${context?.attachments?.length ?? 0}`,
		}));
		const image: ImageContent = {
			type: "image",
			data: "aGVsbG8=",
			mimeType: "image/png",
		};
		const attachment: Attachment = {
			type: "image",
			url: "/tmp/demo.png",
			name: "demo.png",
			mimeType: "image/png",
		};

		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.addChannel(channel);
		gateway.setChatHandler(chatHandler);
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const rpc = async (payload: any) =>
			jsonFetch(`${base}/rpc`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			});

		const rpcMedia = await rpc({
			id: "media-rpc",
			method: "chat.send",
			params: {
				images: [image],
				attachments: [attachment],
			},
		});
		expect(rpcMedia.body.result).toMatchObject({
			response: "images=1;attachments=1",
		});
		expect(chatHandler).toHaveBeenLastCalledWith(
			"",
			expect.objectContaining({
				images: [image],
				attachments: [attachment],
			}),
		);

		const httpMedia = await jsonFetch(`${base}/chat`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				attachments: [attachment],
			}),
		});
		expect(httpMedia.status).toBe(200);
		expect(httpMedia.body).toMatchObject({
			response: "images=0;attachments=1",
		});
		expect(chatHandler).toHaveBeenLastCalledWith(
			"",
			expect.objectContaining({
				attachments: [attachment],
			}),
		);

		channel.emitInbound({
			channelId: "web",
			senderId: "u_media",
			text: "",
			attachments: [attachment],
			timestamp: Date.now(),
		});

		await waitForAssertion(() => {
			expect(chatHandler).toHaveBeenLastCalledWith(
				"",
				expect.objectContaining({
					channelId: "web",
					senderId: "u_media",
					attachments: [attachment],
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					channelId: "web",
					recipientId: "u_media",
					text: "images=0;attachments=1",
				}),
			);
		});
	});

	it("handles message.action RPC send/edit/delete/react operations", async () => {
		const channel = createMockChannel("web");
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.addChannel(channel);
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const rpc = async (payload: any) =>
			jsonFetch(`${base}/rpc`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			});

		const send = await rpc({
			id: "m1",
			method: "message.action",
			params: { action: "send", channelId: "web", recipientId: "u1", text: "hello" },
		});
		expect(send.body.result).toMatchObject({ action: "send", messageId: "out_1" });
		expect(channel.sendMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ channelId: "web", recipientId: "u1", text: "hello" }),
		);

		const edit = await rpc({
			id: "edit_1",
			method: "message.action",
			params: { action: "edit", channelId: "web", recipientId: "u1", messageId: "mid_1", text: "updated" },
		});
		expect(edit.body.result).toMatchObject({ action: "edit", messageId: "mid_1" });
		expect(channel.editMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ channelId: "u1", messageId: "mid_1", text: "updated" }),
		);

		const react = await rpc({
			id: "m3",
			method: "message.action",
			params: { action: "react", channelId: "web", recipientId: "u1", messageId: "mid_1", emoji: "👍" },
		});
		expect(react.body.result).toMatchObject({ action: "react", messageId: "mid_1", emoji: "👍" });
		expect(channel.reactToMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ channelId: "u1", messageId: "mid_1", emoji: "👍" }),
		);

		const del = await rpc({
			id: "m4",
			method: "message.action",
			params: { action: "delete", channelId: "web", recipientId: "u1", messageId: "mid_1" },
		});
		expect(del.body.result).toMatchObject({ action: "delete", messageId: "mid_1" });
		expect(channel.deleteMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ channelId: "u1", messageId: "mid_1" }),
		);

		const poll = await rpc({
			id: "m5",
			method: "message.action",
			params: {
				action: "poll",
				channelId: "web",
				recipientId: "u1",
				pollQuestion: "Lunch?",
				pollOptions: ["Pizza", "Sushi"],
			},
		});
		expect(poll.body.result).toMatchObject({ action: "poll", fallback: "sent-as-message" });
		expect(channel.sendMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({
				channelId: "web",
				recipientId: "u1",
			}),
		);

		const pinUnsupported = await rpc({
			id: "m6",
			method: "message.action",
			params: { action: "pin", channelId: "web", messageId: "mid_1" },
		});
		expect(pinUnsupported.body.error).toMatchObject({ code: 501 });
	});

	it("handles configured agent/browser/secrets bridge handlers", async () => {
		const channel = createMockChannel("web");
		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			agentIdentityGet: async () => ({ agentId: "main", name: "Understudy" }),
			agentWait: async () => ({ runId: "run_1", status: "ok" }),
			agentsList: async () => ({ defaultId: "main", mainKey: "agent:main:main", scope: "per-sender", agents: [{ id: "main" }] }),
			agentsCreate: async () => ({ ok: true, agentId: "ops", name: "Ops", workspace: "/tmp/ops" }),
			agentsUpdate: async () => ({ ok: true, agentId: "ops" }),
			agentsDelete: async () => ({ ok: true, agentId: "ops", removedBindings: 1 }),
			agentsFilesList: async () => ({ agentId: "main", workspace: "/tmp/main", files: [] }),
			agentsFilesGet: async () => ({ agentId: "main", workspace: "/tmp/main", file: { name: "AGENTS.md", path: "/tmp/main/AGENTS.md", missing: true } }),
			agentsFilesSet: async () => ({ ok: true, agentId: "main", workspace: "/tmp/main", file: { name: "AGENTS.md", path: "/tmp/main/AGENTS.md", missing: false, content: "x" } }),
			webLoginStart: async () => ({ message: "started", connected: false }),
			webLoginWait: async () => ({ message: "connected", connected: true }),
			execApprovalRequest: async () => ({ status: "accepted", id: "appr_1" }),
			execApprovalWaitDecision: async () => ({ id: "appr_1", decision: "allow-once" }),
			execApprovalResolve: async () => ({ ok: true }),
			execApprovalsGet: async () => ({ path: "/tmp/exec-approvals.json", exists: true, hash: "h1", file: { version: 1 } }),
			execApprovalsSet: async () => ({ path: "/tmp/exec-approvals.json", exists: true, hash: "h2", file: { version: 1 } }),
			execApprovalsNodeGet: async () => ({ path: "/tmp/exec-approvals-node.json", exists: true, hash: "hn1", file: { version: 1 } }),
			execApprovalsNodeSet: async () => ({ path: "/tmp/exec-approvals-node.json", exists: true, hash: "hn2", file: { version: 1 } }),
			browserRequest: async () => ({ ok: true, action: "tabs" }),
			secretsReload: async () => ({ ok: true, warningCount: 0 }),
			secretsResolve: async () => ({ ok: true, assignments: [], diagnostics: [], inactiveRefPaths: [] }),
			skillsInstall: async () => ({ ok: true, message: "installed" }),
			skillsUpdate: async () => ({ ok: true, skillKey: "skill-a" }),
		});
		gateway.addChannel(channel);
		gateway.setChatHandler(async (text) => ({
			response: `agent:${text}`,
			runId: "run_bridge",
			sessionId: "session_bridge",
		}));
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const rpc = async (payload: any) =>
			jsonFetch(`${base}/rpc`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
			});

		const bridgeSend = await rpc({
			id: "c0a",
			method: "message.action",
			params: { action: "send", channelId: "web", recipientId: "u_1", text: "ping" },
		});
		expect(bridgeSend.body.result).toMatchObject({
			action: "send",
			channelId: "web",
			recipientId: "u_1",
		});

		const identity = await rpc({ id: "c1", method: "agent.identity.get", params: {} });
		expect(identity.body.result).toMatchObject({ agentId: "main", name: "Understudy" });

		const wait = await rpc({ id: "c2", method: "agent.wait", params: { runId: "run_1" } });
		expect(wait.body.result).toMatchObject({ runId: "run_1", status: "ok" });

		const agentsList = await rpc({ id: "c2b", method: "agents.list", params: {} });
		expect(agentsList.body.result).toMatchObject({ defaultId: "main" });

		const agentsCreate = await rpc({
			id: "c2c",
			method: "agents.create",
			params: { name: "Ops", workspace: "/tmp/ops" },
		});
		expect(agentsCreate.body.result).toMatchObject({ ok: true, agentId: "ops" });

		const agentsUpdate = await rpc({
			id: "c2d",
			method: "agents.update",
			params: { agentId: "ops", name: "Ops 2" },
		});
		expect(agentsUpdate.body.result).toMatchObject({ ok: true, agentId: "ops" });

		const agentsDelete = await rpc({
			id: "c2e",
			method: "agents.delete",
			params: { agentId: "ops" },
		});
		expect(agentsDelete.body.result).toMatchObject({ ok: true, agentId: "ops" });

		const filesList = await rpc({
			id: "c2f",
			method: "agents.files.list",
			params: { agentId: "main" },
		});
		expect(filesList.body.result).toMatchObject({ agentId: "main", files: [] });

		const filesGet = await rpc({
			id: "c2g",
			method: "agents.files.get",
			params: { agentId: "main", name: "AGENTS.md" },
		});
		expect(filesGet.body.result).toMatchObject({ agentId: "main" });

		const filesSet = await rpc({
			id: "c2h",
			method: "agents.files.set",
			params: { agentId: "main", name: "AGENTS.md", content: "x" },
		});
		expect(filesSet.body.result).toMatchObject({ ok: true, agentId: "main" });

		const webStart = await rpc({
			id: "c2i",
			method: "web.login.start",
			params: { force: true, timeoutMs: 30000 },
		});
		expect(webStart.body.result).toMatchObject({ message: "started" });

		const webWait = await rpc({
			id: "c2j",
			method: "web.login.wait",
			params: { timeoutMs: 120000 },
		});
		expect(webWait.body.result).toMatchObject({ connected: true });

		const approvalsGet = await rpc({ id: "c2k", method: "exec.approvals.get", params: {} });
		expect(approvalsGet.body.result).toMatchObject({ exists: true, hash: "h1" });

		const approvalReq = await rpc({
			id: "c2l",
			method: "exec.approval.request",
			params: { command: "echo hi", timeoutMs: 1000, twoPhase: true },
		});
		expect(approvalReq.body.result).toMatchObject({ status: "accepted", id: "appr_1" });

		const approvalWait = await rpc({
			id: "c2m",
			method: "exec.approval.waitDecision",
			params: { id: "appr_1", timeoutMs: 1000 },
		});
		expect(approvalWait.body.result).toMatchObject({ id: "appr_1", decision: "allow-once" });

		const approvalResolve = await rpc({
			id: "c2n",
			method: "exec.approval.resolve",
			params: { id: "appr_1", decision: "allow-once" },
		});
		expect(approvalResolve.body.result).toMatchObject({ ok: true });

		const approvalsSet = await rpc({
			id: "c2o",
			method: "exec.approvals.set",
			params: { file: { version: 1 }, baseHash: "h1" },
		});
		expect(approvalsSet.body.result).toMatchObject({ hash: "h2" });

		const approvalsNodeGet = await rpc({
			id: "c2p",
			method: "exec.approvals.node.get",
			params: { nodeId: "node_1" },
		});
		expect(approvalsNodeGet.body.result).toMatchObject({ hash: "hn1" });

		const approvalsNodeSet = await rpc({
			id: "c2q",
			method: "exec.approvals.node.set",
			params: { nodeId: "node_1", file: { version: 1 }, baseHash: "hn1" },
		});
		expect(approvalsNodeSet.body.result).toMatchObject({ hash: "hn2" });

		const skillInstall = await rpc({
			id: "c2r",
			method: "skills.install",
			params: { name: "a", installId: "a", timeoutMs: 1000 },
		});
		expect(skillInstall.body.result).toMatchObject({ ok: true, message: "installed" });

		const skillUpdate = await rpc({
			id: "c2s",
			method: "skills.update",
			params: { skillKey: "skill-a", enabled: true },
		});
		expect(skillUpdate.body.result).toMatchObject({ ok: true, skillKey: "skill-a" });

		const browser = await rpc({ id: "c3", method: "browser.request", params: { method: "GET", path: "/tabs" } });
		expect(browser.body.result).toMatchObject({ ok: true, action: "tabs" });

		const reload = await rpc({ id: "c4", method: "secrets.reload", params: {} });
		expect(reload.body.result).toMatchObject({ ok: true, warningCount: 0 });

		const resolve = await rpc({
			id: "c5",
			method: "secrets.resolve",
			params: { commandName: "doctor", targetIds: [] },
		});
		expect(resolve.body.result).toMatchObject({ ok: true });
	});

	it("handles /chat endpoint with and without chat handler", async () => {
		const channel = createMockChannel("web");
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.addChannel(channel);
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const noHandler = await jsonFetch(`${base}/chat`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hi" }),
		});
		expect(noHandler.status).toBe(503);

		gateway.setChatHandler(async (text, context) => {
			if (text === "explode") throw new Error("boom");
			return `ok:${text}:${context?.cwd ?? "no-cwd"}`;
		});

		const missingText = await jsonFetch(`${base}/chat`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(missingText.status).toBe(400);

		const success = await jsonFetch(`${base}/chat`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "hello", cwd: "/tmp/http-chat" }),
		});
		expect(success.status).toBe(200);
		expect(success.body.response).toBe("ok:hello:/tmp/http-chat");

		const fail = await jsonFetch(`${base}/chat`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "explode" }),
		});
		expect(fail.status).toBe(500);
		expect(fail.body.error).toContain("boom");
	});

	it("routes inbound channel messages to chat handler and broadcasts message events", async () => {
		const channel = createMockChannel("web");
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.addChannel(channel);
		const handler = vi.fn(async (text: string) => `[[reply_to_current]] Echo: ${text} [[audio_as_voice]]`);
		gateway.setChatHandler(handler);
		await gateway.start();

		const port = gatewayPort(gateway);
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("ws open timeout")), 3000);
			ws.once("open", () => {
				clearTimeout(timeout);
				resolve();
			});
			ws.once("error", reject);
		});

		const eventPromise = waitForEvent(ws, (data) => data.type === "message");
		channel.emitInbound({
			channelId: "web",
			senderId: "u1",
			senderName: "Alice",
			conversationName: "WebChat",
			externalMessageId: "msg-u1-1",
			text: "hello",
			timestamp: Date.now(),
		});

		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(channel.sendMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({
				recipientId: "u1",
				replyToMessageId: "msg-u1-1",
				text: "Echo: hello",
			}),
		);
		expect(handler).toHaveBeenCalledWith(
			"hello",
			expect.objectContaining({ channelId: "web", senderId: "u1", senderName: "Alice", conversationName: "WebChat" }),
		);

		const event = await eventPromise;
		expect(event.data).toMatchObject({ channelId: "web", senderId: "agent", text: "Echo: hello" });
		ws.close();
	});

	it("honors explicit reply targets from assistant directives for inbound channel messages", async () => {
		const channel = createMockChannel("web");
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.addChannel(channel);
		gateway.setChatHandler(async () => "[[reply_to:root-msg-9]] Explicit reply");
		await gateway.start();

		channel.emitInbound({
			channelId: "web",
			senderId: "u1",
			externalMessageId: "msg-u1-1",
			text: "hello",
			timestamp: Date.now(),
		});

		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenCalledWith(
				expect.objectContaining({
					recipientId: "u1",
					replyToMessageId: "root-msg-9",
					text: "Explicit reply",
				}),
			);
		});
	});

	it("suppresses bare silent-token replies across HTTP, RPC, and inbound channel delivery", async () => {
		const channel = createMockChannel("web");
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.addChannel(channel);
		gateway.setChatHandler(async () => "[[SILENT]]");
		await gateway.start();
		const base = `http://127.0.0.1:${gatewayPort(gateway)}`;

		const httpResult = await jsonFetch(`${base}/chat`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text: "normal reply already sent" }),
		});
		expect(httpResult.status).toBe(200);
		expect(httpResult.body).toMatchObject({ response: "" });

		const rpcResult = await jsonFetch(`${base}/rpc`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: "silent-rpc",
				method: "chat.send",
				params: { text: "already delivered", channelId: "cli", senderId: "user-silent" },
			}),
		});
		expect(rpcResult.status).toBe(200);
		expect(rpcResult.body.result).toMatchObject({ response: "" });

		channel.emitInbound({
			channelId: "web",
			senderId: "u_silent",
			text: "hello",
			timestamp: Date.now(),
		});

		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(channel.sendMessageMock).not.toHaveBeenCalled();
	});

	it("sends async receipt first and final reply after background completion for inbound channel runs", async () => {
		const channel = createMockChannel("telegram");
		const agentWait = vi
			.fn()
			.mockResolvedValueOnce({ status: "timeout", runId: "run_async", sessionId: "session_async" })
			.mockResolvedValueOnce({
				status: "timeout",
				runId: "run_async",
				sessionId: "session_async",
				progress: {
					summary: 'Clicking "Continue" in Tencent Meeting.',
				},
			})
			.mockResolvedValueOnce({
				status: "ok",
				runId: "run_async",
				sessionId: "session_async",
				response: "[[reply_to:thread-root-42]] final async reply",
			});
		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			agentWait,
		});
		gateway.addChannel(channel);
		const handler = vi.fn(async () => ({
			response: "",
			status: "in_flight",
			runId: "run_async",
			sessionId: "session_async",
		}));
		gateway.setChatHandler(handler);
		await gateway.start();

		channel.emitInbound({
			channelId: "telegram",
			senderId: "u_async",
			text: "do work",
			timestamp: Date.now(),
		});

		await waitForAssertion(() => {
			expect(handler).toHaveBeenCalledWith(
				"do work",
				expect.objectContaining({
					channelId: "telegram",
					senderId: "u_async",
					waitForCompletion: false,
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					channelId: "telegram",
					recipientId: "u_async",
					text: "Thinking through the task...",
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.editMessageMock).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					channelId: "u_async",
					messageId: "out_1",
					recipientId: "u_async",
					text: 'Working through the task...\nCurrent step: Clicking "Continue" in Tencent Meeting.',
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.editMessageMock).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					channelId: "u_async",
					messageId: "out_1",
					recipientId: "u_async",
					text: "final async reply",
				}),
			);
		});
		expect(channel.sendMessageMock).toHaveBeenCalledTimes(1);
		expect(agentWait).toHaveBeenCalledTimes(3);
	});

	it("sends returned screenshots to inbound channels when a background run finishes", async () => {
		const channel = createMockChannel("telegram");
		const agentWait = vi
			.fn()
			.mockResolvedValueOnce({ status: "timeout", runId: "run_media", sessionId: "session_media" })
			.mockResolvedValueOnce({
				status: "ok",
				runId: "run_media",
				sessionId: "session_media",
				response: "已截图。",
				images: [
					{
						type: "image",
						mimeType: "image/png",
						data: "c2NyZWVuc2hvdA==",
					},
				],
			});
		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			agentWait,
		});
		gateway.addChannel(channel);
		gateway.setChatHandler(async () => ({
			response: "",
			status: "in_flight",
			runId: "run_media",
			sessionId: "session_media",
		}));
		await gateway.start();

		channel.emitInbound({
			channelId: "telegram",
			senderId: "u_media",
			text: "截图发给我",
			timestamp: Date.now(),
		});

		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					channelId: "telegram",
					recipientId: "u_media",
					text: "Thinking through the task...",
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.editMessageMock).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					channelId: "u_media",
					messageId: "out_1",
					recipientId: "u_media",
					text: "已截图。",
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					channelId: "telegram",
					recipientId: "u_media",
					text: "",
					attachments: [
						expect.objectContaining({
							type: "image",
							url: "data:image/png;base64,c2NyZWVuc2hvdA==",
						}),
					],
				}),
			);
		});
		expect(agentWait).toHaveBeenCalledTimes(2);
	});

	it("sends in-flight tool screenshots to inbound channels before the run finishes", async () => {
		const channel = createMockChannel("telegram");
		const agentWait = vi
			.fn()
			.mockResolvedValueOnce({ status: "timeout", runId: "run_progress_media", sessionId: "session_progress_media" })
			.mockResolvedValueOnce({
				status: "timeout",
				runId: "run_progress_media",
				sessionId: "session_progress_media",
				progress: {
					stage: "tool",
					toolName: "gui_screenshot",
					route: "gui",
					summary: "Capturing screenshot.",
					latestToolResult: {
						toolCallId: "tool-progress-1",
						toolName: "gui_screenshot",
						route: "gui",
						textPreview: "Captured a GUI screenshot.",
						images: [
							{
								type: "image",
								mimeType: "image/png",
								data: "cHJvZ3Jlc3Mtc2NyZWVuc2hvdA==",
							},
						],
					},
				},
			})
			.mockResolvedValueOnce({
				status: "ok",
				runId: "run_progress_media",
				sessionId: "session_progress_media",
				response: "已经给你截好了。",
			});
		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			agentWait,
		});
		gateway.addChannel(channel);
		gateway.setChatHandler(async () => ({
			response: "",
			status: "in_flight",
			runId: "run_progress_media",
			sessionId: "session_progress_media",
		}));
		await gateway.start();

		channel.emitInbound({
			channelId: "telegram",
			senderId: "u_progress_media",
			text: "截图给我",
			timestamp: Date.now(),
		});

		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					channelId: "telegram",
					recipientId: "u_progress_media",
					text: "Thinking through the task...",
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					channelId: "telegram",
					recipientId: "u_progress_media",
					text: "",
					attachments: [
						expect.objectContaining({
							type: "image",
							url: "data:image/png;base64,cHJvZ3Jlc3Mtc2NyZWVuc2hvdA==",
						}),
					],
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.editMessageMock).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					channelId: "u_progress_media",
					messageId: "out_1",
					recipientId: "u_progress_media",
					text: expect.stringContaining("Capturing screenshot."),
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.editMessageMock).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					channelId: "u_progress_media",
					messageId: "out_1",
					recipientId: "u_progress_media",
					text: "已经给你截好了。",
				}),
			);
		});
		expect(agentWait).toHaveBeenCalledTimes(3);
	});

	it("does not resend the same screenshot when progress media matches the final result", async () => {
		const channel = createMockChannel("telegram");
		const agentWait = vi
			.fn()
			.mockResolvedValueOnce({ status: "timeout", runId: "run_progress_dedupe", sessionId: "session_progress_dedupe" })
			.mockResolvedValueOnce({
				status: "timeout",
				runId: "run_progress_dedupe",
				sessionId: "session_progress_dedupe",
				progress: {
					stage: "tool",
					toolName: "gui_screenshot",
					route: "gui",
					summary: "Capturing screenshot.",
					latestToolResult: {
						toolCallId: "tool-progress-dedupe-1",
						images: [
							{
								type: "image",
								mimeType: "image/png",
								data: "ZGVkdXBlLXNjcmVlbnNob3Q=",
							},
						],
					},
				},
			})
			.mockResolvedValueOnce({
				status: "ok",
				runId: "run_progress_dedupe",
				sessionId: "session_progress_dedupe",
				response: "已经截好了。",
				images: [
					{
						type: "image",
						mimeType: "image/png",
						data: "ZGVkdXBlLXNjcmVlbnNob3Q=",
					},
				],
			});
		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			agentWait,
		});
		gateway.addChannel(channel);
		gateway.setChatHandler(async () => ({
			response: "",
			status: "in_flight",
			runId: "run_progress_dedupe",
			sessionId: "session_progress_dedupe",
		}));
		await gateway.start();

		channel.emitInbound({
			channelId: "telegram",
			senderId: "u_progress_dedupe",
			text: "截图给我",
			timestamp: Date.now(),
		});

		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenCalledTimes(2);
		});
		expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				channelId: "telegram",
				recipientId: "u_progress_dedupe",
				text: "Thinking through the task...",
			}),
		);
		expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				channelId: "telegram",
				recipientId: "u_progress_dedupe",
				text: "",
				attachments: [
					expect.objectContaining({
						type: "image",
						url: "data:image/png;base64,ZGVkdXBlLXNjcmVlbnNob3Q=",
					}),
				],
			}),
		);
		await waitForAssertion(() => {
			expect(channel.editMessageMock).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					channelId: "u_progress_dedupe",
					messageId: "out_1",
					recipientId: "u_progress_dedupe",
					text: "已经截好了。",
				}),
			);
		});
		expect(agentWait).toHaveBeenCalledTimes(3);
	});

	it("falls back to follow-up channel messages when editMessage is unavailable", async () => {
		const channel = createMockChannel("signal");
		delete (channel.messaging as { editMessage?: unknown }).editMessage;
		const agentWait = vi
			.fn()
			.mockResolvedValueOnce({ status: "timeout", runId: "run_async", sessionId: "session_async" })
			.mockResolvedValueOnce({
				status: "timeout",
				runId: "run_async",
				sessionId: "session_async",
				progress: {
					stage: "tool",
					toolName: "gui_click",
					route: "gui",
					summary: 'Clicking "Continue" in Tencent Meeting.',
				},
			})
			.mockResolvedValueOnce({
				status: "ok",
				runId: "run_async",
				sessionId: "session_async",
				response: "[[reply_to:thread-root-42]] final async reply",
			});
		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			agentWait,
		});
		gateway.addChannel(channel);
		gateway.setChatHandler(async () => ({
			response: "",
			status: "in_flight",
			runId: "run_async",
			sessionId: "session_async",
		}));
		await gateway.start();

		channel.emitInbound({
			channelId: "signal",
			senderId: "+15550001111",
			text: "do work",
			timestamp: Date.now(),
		});

		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					channelId: "signal",
					recipientId: "+15550001111",
					text: "Thinking through the task...",
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({
					channelId: "signal",
					recipientId: "+15550001111",
					text: [
						"Working through the task...",
						"Current tool: gui_click · GUI",
						'Current step: Clicking "Continue" in Tencent Meeting.',
					].join("\n"),
				}),
			);
		});
		await waitForAssertion(() => {
			expect(channel.sendMessageMock).toHaveBeenNthCalledWith(
				3,
				expect.objectContaining({
					channelId: "signal",
					recipientId: "+15550001111",
					replyToMessageId: "thread-root-42",
					text: "final async reply",
				}),
			);
		});
		expect(channel.editMessageMock).not.toHaveBeenCalled();
	});

	it("routes inbound channel receipt edits to the conversation id for Slack/Discord-style adapters", async () => {
		const channel = createMockChannel("discord");
		const agentWait = vi
			.fn()
			.mockResolvedValueOnce({ status: "timeout", runId: "run_async", sessionId: "session_async" })
			.mockResolvedValueOnce({
				status: "timeout",
				runId: "run_async",
				sessionId: "session_async",
				progress: {
					stage: "tool",
					toolName: "browser_tabs",
					route: "browser",
					summary: "Inspecting the current thread.",
				},
			})
			.mockResolvedValueOnce({
				status: "ok",
				runId: "run_async",
				sessionId: "session_async",
				response: "done",
			});
		gateway = new GatewayServer({
			port: 0,
			host: "127.0.0.1",
			agentWait,
		});
		gateway.addChannel(channel);
		gateway.setChatHandler(async () => ({
			response: "",
			status: "in_flight",
			runId: "run_async",
			sessionId: "session_async",
		}));
		await gateway.start();

		channel.emitInbound({
			channelId: "discord",
			senderId: "channel_123",
			text: "do work",
			timestamp: Date.now(),
		});

		await waitForAssertion(() => {
			expect(channel.editMessageMock).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({
					channelId: "channel_123",
					recipientId: "channel_123",
					messageId: "out_1",
					text: [
						"Working through the task...",
						"Current tool: browser_tabs · Browser",
						"Current step: Inspecting the current thread.",
					].join("\n"),
				}),
			);
		});
	});

	it("returns channel-visible errors and broadcasts error events on chat failures", async () => {
		const channel = createMockChannel("web");
		gateway = new GatewayServer({ port: 0, host: "127.0.0.1" });
		gateway.addChannel(channel);
		gateway.setChatHandler(async () => {
			throw new Error("handler failed");
		});
		await gateway.start();

		const port = gatewayPort(gateway);
		const ws = new WebSocket(`ws://127.0.0.1:${port}`);
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("ws open timeout")), 3000);
			ws.once("open", () => {
				clearTimeout(timeout);
				resolve();
			});
			ws.once("error", reject);
		});

		const eventPromise = waitForEvent(ws, (data) => data.type === "error");
		channel.emitInbound({
			channelId: "web",
			senderId: "u2",
			text: "boom",
			timestamp: Date.now(),
		});

		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(channel.sendMessageMock).toHaveBeenCalledWith(
			expect.objectContaining({ recipientId: "u2", text: expect.stringContaining("Error: handler failed") }),
		);

		const event = await eventPromise;
		expect(event.data).toMatchObject({ channelId: "web", senderId: "agent", error: "handler failed" });
		ws.close();
	});
});
