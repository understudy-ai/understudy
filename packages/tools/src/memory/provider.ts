import type { MemoryEntry, MemorySearchOptions } from "./memory-store.js";

export interface MemoryProvider {
	init(): Promise<void>;
	add(content: string, metadata?: Record<string, unknown>): Promise<string>;
	get(id: string): Promise<MemoryEntry | null>;
	search(options: MemorySearchOptions): Promise<MemoryEntry[]>;
	delete(id: string): Promise<boolean>;
	close(): Promise<void>;
}
