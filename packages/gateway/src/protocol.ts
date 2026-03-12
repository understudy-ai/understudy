/**
 * Gateway protocol types.
 * Defines RPC methods and event types for gateway communication.
 */

/** RPC methods the gateway handles */
export type GatewayMethod =
	| "agent.identity.get"
	| "agent.wait"
	| "agents.create"
	| "agents.delete"
	| "agents.files.get"
	| "agents.files.list"
	| "agents.files.set"
	| "agents.list"
	| "agents.update"
	| "browser.request"
	| "chat.send"
	| "chat.stream"
	| "chat.abort"
	| "message.action"
	| "session.list"
	| "session.get"
	| "session.history"
	| "session.trace"
	| "session.teach.list"
	| "session.teach.create"
	| "session.teach.record.start"
	| "session.teach.record.status"
	| "session.teach.record.stop"
	| "session.teach.video"
	| "session.teach.update"
	| "session.teach.validate"
	| "session.teach.publish"
	| "runtime.readiness"
	| "session.create"
	| "session.send"
	| "session.patch"
	| "session.reset"
	| "session.delete"
	| "session.compact"
	| "session.branch"
	| "sessions.spawn"
	| "subagents"
	| "exec.approval.request"
	| "exec.approval.waitDecision"
	| "exec.approval.resolve"
	| "exec.approvals.get"
	| "exec.approvals.node.get"
	| "exec.approvals.node.set"
	| "exec.approvals.set"
	| "channel.list"
	| "channel.status"
	| "channel.logout"
	| "capabilities.get"
	| "secrets.reload"
	| "secrets.resolve"
	| "config.get"
	| "config.apply"
	| "config.schema"
	| "config.reload"
	| "schedule.list"
	| "schedule.status"
	| "schedule.add"
	| "schedule.update"
	| "schedule.remove"
	| "schedule.run"
	| "schedule.runs"
	| "models.list"
	| "tools.catalog"
	| "skills.status"
	| "skills.install"
	| "skills.update"
	| "pairing.request"
	| "pairing.approve"
	| "pairing.reject"
	| "usage.summary"
	| "usage.daily"
	| "usage.status"
	| "usage.cost"
	| "web.login.start"
	| "web.login.wait"
	| "logs.tail"
	| "health";

/** RPC capability inventory returned by capabilities.get */
export interface GatewayCapabilityMethodDescriptor {
	name: string;
	namespace: string;
	group: string;
}

export interface GatewayCapabilityNamespaceDescriptor {
	name: string;
	methodCount: number;
	methods: string[];
	groups: string[];
}

export interface GatewayCapabilityGroupDescriptor {
	name: string;
	namespace: string;
	methodCount: number;
	methods: string[];
}

export interface GatewayCapabilityInventory {
	methods: GatewayCapabilityMethodDescriptor[];
	namespaces: GatewayCapabilityNamespaceDescriptor[];
	groups: GatewayCapabilityGroupDescriptor[];
}

export interface GatewayCapabilityTransportAuth {
	mode: string;
	required: boolean;
}

export interface GatewayCapabilityHttpTransport {
	enabled: boolean;
	host: string;
	port: number;
	auth: GatewayCapabilityTransportAuth;
	routes: {
		rpc: string;
		rpcView: string;
		health: string;
		chat: string;
		channels: string;
	};
}

export interface GatewayCapabilityWebSocketTransport {
	enabled: boolean;
	host: string;
	port: number;
	path: string;
	sharedPort: boolean;
	auth: GatewayCapabilityTransportAuth;
}

export interface GatewayCapabilityTransportInfo {
	http: GatewayCapabilityHttpTransport;
	websocket: GatewayCapabilityWebSocketTransport;
}

export interface GatewayCapabilitiesResult {
	schemaVersion: 1;
	generatedAt: number;
	inventory: GatewayCapabilityInventory;
	transport: GatewayCapabilityTransportInfo;
	[key: string]: unknown;
}

/** Events the gateway broadcasts */
export type GatewayEventType =
	| "message"
	| "stream_start"
	| "stream_chunk"
	| "stream_end"
	| "tool_start"
	| "tool_end"
	| "error"
	| "status_change"
	| "schedule.triggered"
	| "schedule.completed"
	| "config.changed"
	| "channel.status_changed"
	| "exec.approval.requested"
	| "exec.approval.resolved";

/** RPC request format */
export interface GatewayRequest {
	id: string;
	method: GatewayMethod;
	params: Record<string, unknown>;
}

/** RPC response format */
export interface GatewayResponse {
	id: string;
	result?: unknown;
	error?: {
		code: number;
		message: string;
	};
}

/** Event broadcast format */
export interface GatewayEvent {
	type: GatewayEventType;
	data: Record<string, unknown>;
	timestamp: number;
}
