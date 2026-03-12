import { MemoryStore } from "./memory-store.js";
import type { MemoryProvider } from "./provider.js";

export interface CreateMemoryProviderOptions {
	dbPath: string;
}

export async function createMemoryProvider(
	options: CreateMemoryProviderOptions,
): Promise<MemoryProvider> {
	const provider = new MemoryStore({
		dbPath: options.dbPath,
	});
	await provider.init();
	return provider;
}
