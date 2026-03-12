/**
 * UsageTracker: records and aggregates token usage across sessions and channels.
 * In-memory ring buffer with configurable capacity.
 */

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
	model: string;
	provider: string;
	timestamp: number;
	sessionId?: string;
	channelId?: string;
}

export interface UsageSummary {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
	byModel: Record<string, { input: number; output: number; count: number }>;
	byChannel: Record<string, { input: number; output: number; count: number }>;
	recordCount: number;
	sinceMs: number;
}

export class UsageTracker {
	private buffer: TokenUsage[] = [];
	private maxCapacity: number;

	constructor(maxCapacity = 10_000) {
		this.maxCapacity = maxCapacity;
	}

	/** Record a token usage event */
	record(usage: TokenUsage): void {
		this.buffer.push(usage);
		if (this.buffer.length > this.maxCapacity) {
			// Remove oldest entries
			this.buffer = this.buffer.slice(-this.maxCapacity);
		}
	}

	/**
	 * Get aggregated summary, optionally filtering to entries since a given timestamp.
	 */
	getSummary(sinceMs?: number): UsageSummary {
		const cutoff = sinceMs ?? 0;
		const filtered = cutoff > 0
			? this.buffer.filter((u) => u.timestamp >= cutoff)
			: this.buffer;

		const byModel: Record<string, { input: number; output: number; count: number }> = {};
		const byChannel: Record<string, { input: number; output: number; count: number }> = {};
		let totalInput = 0;
		let totalOutput = 0;

		for (const usage of filtered) {
			totalInput += usage.inputTokens;
			totalOutput += usage.outputTokens;

			const modelKey = `${usage.provider}/${usage.model}`;
			if (!byModel[modelKey]) {
				byModel[modelKey] = { input: 0, output: 0, count: 0 };
			}
			byModel[modelKey].input += usage.inputTokens;
			byModel[modelKey].output += usage.outputTokens;
			byModel[modelKey].count++;

			const channelKey = usage.channelId ?? "unknown";
			if (!byChannel[channelKey]) {
				byChannel[channelKey] = { input: 0, output: 0, count: 0 };
			}
			byChannel[channelKey].input += usage.inputTokens;
			byChannel[channelKey].output += usage.outputTokens;
			byChannel[channelKey].count++;
		}

		return {
			totalInputTokens: totalInput,
			totalOutputTokens: totalOutput,
			totalTokens: totalInput + totalOutput,
			byModel,
			byChannel,
			recordCount: filtered.length,
			sinceMs: cutoff,
		};
	}

	/** Get summary for the last 24 hours */
	getDaily(): UsageSummary {
		return this.getSummary(Date.now() - 24 * 60 * 60 * 1000);
	}

	/** Current record count */
	get size(): number {
		return this.buffer.length;
	}

	/** Clear all records */
	clear(): void {
		this.buffer = [];
	}
}
