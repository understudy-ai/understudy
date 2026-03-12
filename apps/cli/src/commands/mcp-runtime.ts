import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { asRecord as asCanonicalRecord, asString, asStringArray as asCanonicalStringArray } from "@understudy/core";

interface McpServerConfig {
	command: string;
	args: string[];
	env?: Record<string, string>;
	cwd?: string;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (reason?: unknown) => void;
	timeout: ReturnType<typeof setTimeout>;
}

interface McpToolDescriptor {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

export interface McpToolBinding {
	server: string;
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

export interface McpServerStatus {
	server: string;
	command: string;
	connected: boolean;
	toolCount: number;
	error?: string;
}

export interface McpRuntimeLoadResult {
	manager: McpRuntimeManager;
	warnings: string[];
}

function sanitizeServerConfig(value: unknown): McpServerConfig | undefined {
	const raw = asCanonicalRecord(value) ?? {};
	const command = asString(raw.command);
	if (!command) return undefined;
	const args = asCanonicalStringArray(raw.args) ?? [];
	const envRaw = asCanonicalRecord(raw.env) ?? {};
	const envEntries = Object.entries(envRaw)
		.filter((entry): entry is [string, string] => typeof entry[1] === "string")
		.map(([key, val]) => [key, val.trim()] as const)
		.filter((entry) => entry[0].trim().length > 0);
	return {
		command,
		args,
		env: envEntries.length > 0 ? Object.fromEntries(envEntries) : undefined,
		cwd: asString(raw.cwd),
	};
}

class StdioMcpClient {
	private readonly process: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number, PendingRequest>();
	private nextId = 1;
	private stdoutBuffer = Buffer.alloc(0);
	private expectedBodyBytes: number | null = null;
	private closed = false;
	private stderrTail = "";

	constructor(private readonly config: McpServerConfig) {
		this.process = spawn(config.command, config.args, {
			stdio: ["pipe", "pipe", "pipe"],
			cwd: config.cwd,
			env: {
				...process.env,
				...config.env,
			},
		});
		this.process.stdout.on("data", (chunk: Buffer) => this.onStdoutChunk(chunk));
		this.process.stderr.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf-8");
			this.stderrTail = `${this.stderrTail}${text}`.slice(-4000);
		});
		this.process.on("exit", (code, signal) => {
			this.closed = true;
			const reason = new Error(`MCP process exited (code=${code ?? "null"}, signal=${signal ?? "null"})`);
			for (const request of this.pending.values()) {
				clearTimeout(request.timeout);
				request.reject(reason);
			}
			this.pending.clear();
		});
		this.process.on("error", (error) => {
			this.closed = true;
			for (const request of this.pending.values()) {
				clearTimeout(request.timeout);
				request.reject(error);
			}
			this.pending.clear();
		});
	}

	private onStdoutChunk(chunk: Buffer): void {
		this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
		for (;;) {
			if (this.expectedBodyBytes === null) {
				const headerEnd = this.stdoutBuffer.indexOf("\r\n\r\n");
				if (headerEnd === -1) {
					const lineEnd = this.stdoutBuffer.indexOf("\n");
					if (lineEnd === -1) {
						return;
					}
					const line = this.stdoutBuffer.slice(0, lineEnd).toString("utf-8").trim();
					this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1);
					if (line.startsWith("{")) {
						this.handleMessage(line);
						continue;
					}
					return;
				}
				const header = this.stdoutBuffer.slice(0, headerEnd).toString("utf-8");
				const match = /content-length:\s*(\d+)/i.exec(header);
				this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4);
				if (!match) {
					continue;
				}
				this.expectedBodyBytes = Number.parseInt(match[1]!, 10);
			}
			if (this.expectedBodyBytes === null || this.stdoutBuffer.length < this.expectedBodyBytes) {
				return;
			}
			const body = this.stdoutBuffer.slice(0, this.expectedBodyBytes).toString("utf-8");
			this.stdoutBuffer = this.stdoutBuffer.slice(this.expectedBodyBytes);
			this.expectedBodyBytes = null;
			this.handleMessage(body);
		}
	}

	private handleMessage(raw: string): void {
		let payload: Record<string, unknown>;
		try {
			payload = JSON.parse(raw) as Record<string, unknown>;
		} catch {
			return;
		}
		const id = typeof payload.id === "number" ? payload.id : undefined;
		if (id === undefined) return;
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		clearTimeout(pending.timeout);
		if (payload.error && typeof payload.error === "object") {
			const errorRecord = payload.error as Record<string, unknown>;
			const message = asString(errorRecord.message) ?? "MCP request failed";
			pending.reject(new Error(message));
			return;
		}
		pending.resolve(payload.result);
	}

	private writePacket(payload: Record<string, unknown>): void {
		const body = JSON.stringify(payload);
		const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
		this.process.stdin.write(`${header}${body}`);
	}

	async request(method: string, params?: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
		if (this.closed) {
			throw new Error("MCP process is not running");
		}
		const id = this.nextId++;
		const response = new Promise<unknown>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP request timed out: ${method}`));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timeout });
		});
		this.writePacket({
			jsonrpc: "2.0",
			id,
			method,
			...(params ? { params } : {}),
		});
		return response;
	}

	notify(method: string, params?: Record<string, unknown>): void {
		if (this.closed) return;
		this.writePacket({
			jsonrpc: "2.0",
			method,
			...(params ? { params } : {}),
		});
	}

	async initialize(): Promise<void> {
		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: {
				name: "understudy",
				version: "0.1.0",
			},
		});
		this.notify("notifications/initialized", {});
	}

	async listTools(): Promise<McpToolDescriptor[]> {
		const result = asCanonicalRecord(await this.request("tools/list", {})) ?? {};
		const toolsRaw = Array.isArray(result.tools) ? result.tools : [];
		return toolsRaw
			.map((item) => asCanonicalRecord(item) ?? {})
			.map((item) => {
				const name = asString(item.name);
				if (!name) return null;
				return {
					name,
					description: asString(item.description),
					inputSchema: asCanonicalRecord(item.inputSchema) ?? {},
				} as McpToolDescriptor;
			})
			.filter((item): item is McpToolDescriptor => Boolean(item));
	}

	async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
		return this.request("tools/call", {
			name: toolName,
			arguments: args,
		}, 120_000);
	}

	getStderrTail(): string {
		return this.stderrTail.trim();
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error("MCP client closed"));
		}
		this.pending.clear();
		this.process.kill("SIGTERM");
	}
}

export class McpRuntimeManager {
	private readonly clients = new Map<string, StdioMcpClient>();
	private readonly tools = new Map<string, McpToolBinding[]>();
	private readonly status = new Map<string, McpServerStatus>();

	static async load(homeDir: string, explicitConfigPath?: string): Promise<McpRuntimeLoadResult> {
		const manager = new McpRuntimeManager();
		const warnings: string[] = [];
		const configPath = explicitConfigPath && explicitConfigPath.trim().length > 0
			? explicitConfigPath
			: join(homeDir, "mcp.json");
		if (!existsSync(configPath)) {
			return { manager, warnings };
		}
		let parsed: Record<string, unknown>;
		try {
			const raw = await readFile(configPath, "utf-8");
			parsed = asCanonicalRecord(JSON.parse(raw)) ?? {};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`failed to parse MCP config ${configPath}: ${message}`);
			return { manager, warnings };
		}
		const serversRoot = asCanonicalRecord(parsed.mcpServers) ?? {};
		for (const [serverNameRaw, serverValue] of Object.entries(serversRoot)) {
			const serverName = asString(serverNameRaw);
			if (!serverName) continue;
			const disabled = (asCanonicalRecord(serverValue) ?? {}).disabled === true;
			if (disabled) {
				continue;
			}
			const serverConfig = sanitizeServerConfig(serverValue);
			if (!serverConfig) {
				warnings.push(`mcp server "${serverName}" skipped: command is required`);
				continue;
			}
			await manager.attachServer(serverName, serverConfig, warnings);
		}
		return { manager, warnings };
	}

	private async attachServer(
		serverName: string,
		config: McpServerConfig,
		warnings: string[],
	): Promise<void> {
		const commandPreview = [config.command, ...config.args].join(" ");
		try {
			const client = new StdioMcpClient(config);
			await client.initialize();
			const tools = await client.listTools();
			this.clients.set(serverName, client);
			this.tools.set(serverName, tools.map((tool) => ({
				server: serverName,
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			})));
			this.status.set(serverName, {
				server: serverName,
				command: commandPreview,
				connected: true,
				toolCount: tools.length,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`mcp server "${serverName}" failed to initialize: ${message}`);
			this.status.set(serverName, {
				server: serverName,
				command: commandPreview,
				connected: false,
				toolCount: 0,
				error: message,
			});
		}
	}

	getTools(): McpToolBinding[] {
		const tools: McpToolBinding[] = [];
		for (const list of this.tools.values()) {
			tools.push(...list);
		}
		return tools;
	}

	getStatus(): McpServerStatus[] {
		return Array.from(this.status.values()).sort((a, b) => a.server.localeCompare(b.server));
	}

	async call(serverName: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
		const client = this.clients.get(serverName);
		if (!client) {
			throw new Error(`MCP server is not connected: ${serverName}`);
		}
		try {
			return await client.callTool(toolName, args);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stderr = client.getStderrTail();
			if (stderr) {
				throw new Error(`${message}\n${stderr}`);
			}
			throw error;
		}
	}

	async close(): Promise<void> {
		for (const client of this.clients.values()) {
			await client.close().catch(() => {});
		}
		this.clients.clear();
	}
}
