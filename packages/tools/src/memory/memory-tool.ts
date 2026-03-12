/**
 * Memory search and management tools for Understudy.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { MemoryProvider } from "./provider.js";
import { textResult } from "../bridge/bridge-rpc.js";

const MemorySearchSchema = Type.Object({
	query: Type.String({ description: "Memory search query (topic, person, decision, date, or keyword)." }),
	limit: Type.Optional(
		Type.Number({
			description: "Maximum results to return (default 5, max 20).",
			minimum: 1,
			maximum: 20,
		}),
	),
});

const MemoryManageSchema = Type.Object({
	action: Type.String({
		description: 'Action: "add" or "delete".',
	}),
	content: Type.Optional(Type.String({ description: "Memory content to store when action=add." })),
	id: Type.Optional(Type.String({ description: "Memory ID for delete action." })),
	metadata: Type.Optional(Type.Any({ description: "Optional structured metadata for add action." })),
});

const MemoryGetSchema = Type.Object({
	id: Type.String({ description: "Memory ID to retrieve." }),
});

type MemorySearchParams = Static<typeof MemorySearchSchema>;
type MemoryManageParams = Static<typeof MemoryManageSchema>;
type MemoryGetParams = Static<typeof MemoryGetSchema>;

export function createMemorySearchTool(store: MemoryProvider): AgentTool<typeof MemorySearchSchema> {
	return {
		name: "memory_search",
		label: "Memory Search",
		description:
			"Search stored memories and return ranked matches. " +
			"Use before answering questions about prior decisions, preferences, or past context.",
		parameters: MemorySearchSchema,
		execute: async (_toolCallId, params: MemorySearchParams): Promise<AgentToolResult<unknown>> => {
			try {
				const results = await store.search({
					query: params.query,
					limit: params.limit ?? 5,
				});

				if (results.length === 0) {
					return textResult(`No memories found for: "${params.query}"`);
				}

				const formatted = results
					.map((r, i) => {
						const meta = r.metadata ? ` (${JSON.stringify(r.metadata)})` : "";
						const date = new Date(r.createdAt).toISOString();
						return `${i + 1}. [${r.id}] ${date}${meta}\n   ${r.content}`;
					})
					.join("\n\n");

				return textResult(`Found ${results.length} memories:\n\n${formatted}`);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return textResult(`Memory search error: ${msg}`);
			}
		},
	};
}

export function createMemoryManageTool(store: MemoryProvider): AgentTool<typeof MemoryManageSchema> {
	return {
		name: "memory_manage",
		label: "Memory Manager",
		description:
			"Create/delete memory entries by explicit action. " +
			'Actions: "add", "delete".',
		parameters: MemoryManageSchema,
		execute: async (_toolCallId, params: MemoryManageParams): Promise<AgentToolResult<unknown>> => {
			try {
				switch (params.action) {
					case "add": {
						if (!params.content) return textResult("Error: content required for add");
						const id = await store.add(params.content, params.metadata as Record<string, unknown>);
						return textResult(`Memory stored with ID: ${id}`);
					}
					case "delete": {
						if (!params.id) return textResult("Error: id required for delete");
						const deleted = await store.delete(params.id);
						return textResult(deleted ? `Deleted memory: ${params.id}` : `Memory not found: ${params.id}`);
					}
					default:
						return textResult(`Unknown action: ${params.action}`);
				}
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return textResult(`Memory error: ${msg}`);
			}
		},
	};
}

export function createMemoryGetTool(store: MemoryProvider): AgentTool<typeof MemoryGetSchema> {
	return {
		name: "memory_get",
		label: "Memory Get",
		description: "Retrieve a single memory entry by ID.",
		parameters: MemoryGetSchema,
		execute: async (_toolCallId, params: MemoryGetParams): Promise<AgentToolResult<unknown>> => {
			try {
				const entry = await store.get(params.id);
				if (!entry) {
					return textResult(`Memory not found: ${params.id}`);
				}
				return textResult(
					`ID: ${entry.id}\nCreated: ${new Date(entry.createdAt).toISOString()}\nContent: ${entry.content}`,
				);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				return textResult(`Memory get error: ${msg}`);
			}
		},
	};
}
