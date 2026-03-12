/**
 * Sessions command: manage agent sessions via RPC.
 */

import type { SessionSummary } from "@understudy/gateway";
import { createRpcClient } from "../rpc-client.js";

interface SessionsOptions {
	list?: boolean;
	preview?: string;
	reset?: string;
	delete?: string;
	compact?: string;
	branch?: string;
	forkPoint?: string;
	branchId?: string;
	json?: boolean;
	port?: string;
}

interface SessionBranchResult extends SessionSummary {
	inheritedMessages?: number;
}

export async function runSessionsCommand(opts: SessionsOptions = {}): Promise<void> {
	const client = createRpcClient({ port: opts.port ? parseInt(opts.port, 10) : undefined });

	try {
		if (opts.preview) {
			const result = await client.call<SessionSummary | null>("session.get", { sessionId: opts.preview });
			if (!result) {
				console.log(`Session not found: ${opts.preview}`);
				return;
			}
			console.log(opts.json ? JSON.stringify(result, null, 2) : formatSession(result));
			return;
		}

		if (opts.delete) {
			await client.call("session.delete", { sessionId: opts.delete });
			console.log(`Session deleted: ${opts.delete}`);
			return;
		}

		if (opts.reset) {
			await client.call("session.reset", { sessionId: opts.reset });
			console.log(`Session reset: ${opts.reset}`);
			return;
		}

		if (opts.compact) {
			await client.call("session.compact", { sessionId: opts.compact });
			console.log(`Session compacted: ${opts.compact}`);
			return;
		}

		if (opts.branch) {
			const forkPointRaw = opts.forkPoint ? Number.parseInt(opts.forkPoint, 10) : undefined;
			const result = await client.call<SessionBranchResult>("session.branch", {
				sessionId: opts.branch,
				forkPoint: Number.isFinite(forkPointRaw ?? NaN) ? forkPointRaw : undefined,
				branchId: opts.branchId,
			});
			const branchSessionId = typeof result.id === "string" ? result.id : opts.branchId ?? "(unknown)";
			const parentId = typeof result.parentId === "string" ? result.parentId : opts.branch;
			const forkPoint = typeof result.forkPoint === "number" ? result.forkPoint : opts.forkPoint ?? "(end)";
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(`Session branched: ${parentId} -> ${branchSessionId} (forkPoint=${forkPoint})`);
			return;
		}

		// Default: list
		const sessions = await client.call<SessionSummary[]>("session.list");
		if (opts.json) {
			console.log(JSON.stringify(sessions, null, 2));
			return;
		}
		if (!sessions || sessions.length === 0) {
			console.log("No active sessions.");
			return;
		}
		console.log(`Active sessions (${sessions.length}):`);
		for (const session of sessions) {
			const age = session.lastActiveAt
				? `${Math.round((Date.now() - session.lastActiveAt) / 60000)}m ago`
				: "unknown";
			console.log(`  ${session.id} — ${session.messageCount ?? 0} msgs, last active ${age}`);
		}
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}

function formatSession(session: SessionSummary): string {
	const lines = [`Session: ${session.id}`];
	if (session.parentId) lines.push(`  Parent:   ${session.parentId}`);
	if (session.forkPoint !== undefined) lines.push(`  Fork:     ${session.forkPoint}`);
	if (session.channelId) lines.push(`  Channel:  ${session.channelId}`);
	if (session.conversationName) lines.push(`  Context:  ${session.conversationName}`);
	if (session.senderId) lines.push(`  Sender:   ${session.senderId}`);
	if (session.senderName) lines.push(`  Name:     ${session.senderName}`);
	if (session.createdAt) lines.push(`  Created:  ${new Date(session.createdAt).toISOString()}`);
	if (session.lastActiveAt) lines.push(`  Active:   ${new Date(session.lastActiveAt).toISOString()}`);
	if (session.messageCount !== undefined) lines.push(`  Messages: ${session.messageCount}`);
	return lines.join("\n");
}
