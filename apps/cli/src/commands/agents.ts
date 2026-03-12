import { createRpcClient } from "../rpc-client.js";

interface AgentsOptions {
	list?: boolean;
	create?: string;
	update?: string;
	delete?: string;
	workspace?: string;
	model?: string;
	emoji?: string;
	avatar?: string;
	setName?: string;
	deleteFiles?: boolean;
	json?: boolean;
	port?: string;
}

export async function runAgentsCommand(opts: AgentsOptions = {}): Promise<void> {
	const client = createRpcClient({ port: opts.port ? parseInt(opts.port, 10) : undefined });

	try {
		if (opts.create) {
			if (!opts.workspace) {
				throw new Error("agents.create requires --workspace");
			}
			const result = await client.call<Record<string, unknown>>("agents.create", {
				name: opts.create,
				workspace: opts.workspace,
				model: opts.model,
				emoji: opts.emoji,
				avatar: opts.avatar,
			});
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(`Agent created: ${String(result.agentId ?? opts.create)}`);
			if (result.workspace) {
				console.log(`Workspace: ${String(result.workspace)}`);
			}
			return;
		}

		if (opts.update) {
			const result = await client.call<Record<string, unknown>>("agents.update", {
				agentId: opts.update,
				name: opts.setName,
				workspace: opts.workspace,
				model: opts.model,
				avatar: opts.avatar,
			});
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(`Agent updated: ${opts.update}`);
			return;
		}

		if (opts.delete) {
			const result = await client.call<Record<string, unknown>>("agents.delete", {
				agentId: opts.delete,
				deleteFiles: opts.deleteFiles,
			});
			if (opts.json) {
				console.log(JSON.stringify(result, null, 2));
				return;
			}
			console.log(`Agent deleted: ${opts.delete}`);
			if (result.removedBindings !== undefined) {
				console.log(`Removed bindings: ${String(result.removedBindings)}`);
			}
			return;
		}

		const result = await client.call<{
			defaultId?: string;
			scope?: string;
			mainKey?: string;
			agents?: Array<{ id: string; name?: string }>;
		}>("agents.list", {});
		if (opts.json) {
			console.log(JSON.stringify(result, null, 2));
			return;
		}
		const agents = Array.isArray(result.agents) ? result.agents : [];
		console.log(`Agents (${agents.length}):`);
		if (result.defaultId) {
			console.log(`Default: ${result.defaultId}`);
		}
		if (result.scope) {
			console.log(`Scope:   ${result.scope}`);
		}
		for (const agent of agents) {
			const defaultSuffix = agent.id === result.defaultId ? " [default]" : "";
			console.log(`  ${agent.id} — ${agent.name ?? agent.id}${defaultSuffix}`);
		}
	} catch (error) {
		console.error("Error:", error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
