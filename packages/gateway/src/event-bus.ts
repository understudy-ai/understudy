/**
 * EventBus: typed event system for gateway lifecycle events.
 * Supports wildcard listeners and recent event ring buffer.
 */

export type GatewayBusEventType =
	| "gateway.start"
	| "gateway.stop"
	| "channel.start"
	| "channel.stop"
	| "channel.error"
	| "channel.restart"
	| "session.create"
	| "session.reset"
	| "auth.success"
	| "auth.failure"
	| "auth.rate_limited"
	| "chat.start"
	| "chat.complete"
	| "chat.error"
	| "schedule.triggered"
	| "schedule.completed"
	| "config.changed"
	| "channel.status_changed";

export interface BusEvent {
	type: GatewayBusEventType;
	data: Record<string, unknown>;
	timestamp: number;
}

export type BusEventListener = (event: BusEvent) => void;

export class EventBus {
	private listeners = new Map<string, Set<BusEventListener>>();
	private wildcardListeners = new Set<BusEventListener>();
	private recentEvents: BusEvent[] = [];
	private maxRecent: number;

	constructor(maxRecent = 1000) {
		this.maxRecent = maxRecent;
	}

	/** Emit an event to all matching listeners */
	emit(type: GatewayBusEventType, data: Record<string, unknown> = {}): void {
		const event: BusEvent = { type, data, timestamp: Date.now() };

		// Store in recent buffer
		this.recentEvents.push(event);
		if (this.recentEvents.length > this.maxRecent) {
			this.recentEvents = this.recentEvents.slice(-this.maxRecent);
		}

		// Notify exact match listeners
		const exactListeners = this.listeners.get(type);
		if (exactListeners) {
			for (const listener of exactListeners) {
				try { listener(event); } catch { /* swallow listener errors */ }
			}
		}

		// Notify prefix match listeners (e.g., "channel.*" matches "channel.start")
		for (const [pattern, patternListeners] of this.listeners) {
			if (pattern.endsWith(".*")) {
				const prefix = pattern.slice(0, -2);
				if (type.startsWith(prefix + ".") && pattern !== type) {
					for (const listener of patternListeners) {
						try { listener(event); } catch { /* swallow */ }
					}
				}
			}
		}

		// Notify wildcard listeners
		for (const listener of this.wildcardListeners) {
			try { listener(event); } catch { /* swallow */ }
		}
	}

	/**
	 * Subscribe to events.
	 * @param type Event type, prefix pattern ("channel.*"), or "*" for all
	 * @returns Unsubscribe function
	 */
	on(type: string, listener: BusEventListener): () => void {
		if (type === "*") {
			this.wildcardListeners.add(listener);
			return () => { this.wildcardListeners.delete(listener); };
		}

		if (!this.listeners.has(type)) {
			this.listeners.set(type, new Set());
		}
		this.listeners.get(type)!.add(listener);
		return () => {
			this.listeners.get(type)?.delete(listener);
			if (this.listeners.get(type)?.size === 0) {
				this.listeners.delete(type);
			}
		};
	}

	/** Get recent events, optionally filtered by type prefix */
	getRecent(filterPrefix?: string, limit?: number): BusEvent[] {
		let events = filterPrefix
			? this.recentEvents.filter((e) => e.type.startsWith(filterPrefix))
			: this.recentEvents;
		if (limit && limit > 0) {
			events = events.slice(-limit);
		}
		return events;
	}

	/** Clear all listeners and recent events */
	clear(): void {
		this.listeners.clear();
		this.wildcardListeners.clear();
		this.recentEvents = [];
	}

	/** Get count of recent events */
	get recentCount(): number {
		return this.recentEvents.length;
	}
}
