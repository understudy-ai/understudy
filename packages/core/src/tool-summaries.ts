/**
 * Extract tool summaries from AgentTool instances for system prompt injection.
 */

export interface ToolSummarySource {
	name: string;
	description?: string;
	label?: string;
}

export function buildToolSummaryMap(tools: ToolSummarySource[]): Record<string, string> {
	const summaries: Record<string, string> = {};
	for (const tool of tools) {
		const summary = tool.description?.trim() || tool.label?.trim();
		if (!summary) {
			continue;
		}
		summaries[tool.name.toLowerCase()] = summary;
	}
	return summaries;
}
