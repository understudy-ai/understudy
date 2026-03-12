import { asRecord } from "@understudy/core";

export function extractLatestAssistantUsage(messages: Array<any>): Record<string, unknown> | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") {
			continue;
		}
		const usage = asRecord(msg.usage);
		if (usage && Object.keys(usage).length > 0) {
			return usage;
		}
	}
	return undefined;
}
