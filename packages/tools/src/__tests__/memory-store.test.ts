import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryStore } from "../memory/memory-store.js";

const sqliteState = vi.hoisted(() => ({
	entries: new Map<string, {
		id: string;
		content: string;
		metadata: string | null;
		created_at: number;
		updated_at: number;
	}>(),
}));

vi.mock("better-sqlite3", () => {
	class MockDatabase {
		exec(): void {}

		prepare(query: string) {
			if (query.includes("INSERT INTO memories")) {
				return {
					run(id: string, content: string, metadata: string | null, createdAt: number, updatedAt: number) {
						sqliteState.entries.set(id, {
							id,
							content,
							metadata,
							created_at: createdAt,
							updated_at: updatedAt,
						});
						return { changes: 1 };
					},
				};
			}
			if (query.includes("SELECT * FROM memories WHERE id = ?")) {
				return {
					get(id: string) {
						return sqliteState.entries.get(id);
					},
				};
			}
			if (query.includes("JOIN memories_fts")) {
				return {
					all(rawQuery: string, limit: number) {
						const terms = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
						return Array.from(sqliteState.entries.values())
							.filter((entry) => terms.every((term) => entry.content.toLowerCase().includes(term)))
							.slice(0, limit);
					},
				};
			}
			if (query.includes("ORDER BY updated_at DESC")) {
				return {
					all(limit: number) {
						return Array.from(sqliteState.entries.values())
							.sort((left, right) => right.updated_at - left.updated_at)
							.slice(0, limit);
					},
				};
			}
			if (query.includes("DELETE FROM memories WHERE id = ?")) {
				return {
					run(id: string) {
						const deleted = sqliteState.entries.delete(id);
						return { changes: deleted ? 1 : 0 };
					},
				};
			}
			throw new Error(`Unhandled sqlite query in test: ${query}`);
		}

		close(): void {}
	}

	return {
		default: MockDatabase,
	};
});

describe("MemoryStore", () => {
	it("supports add/get/search/delete in memory mode", async () => {
		sqliteState.entries.clear();
		const store = MemoryStore.inMemory();
		await store.init();

		const id = await store.add("Understudy memory hello world", { tag: "test" });
		const got = await store.get(id);
		expect(got?.id).toBe(id);
		expect(got?.content).toContain("hello");

		const search = await store.search({ query: "hello", limit: 5 });
		expect(search.length).toBeGreaterThan(0);
		expect(search[0].id).toBe(id);

		const deleted = await store.delete(id);
		expect(deleted).toBe(true);
		expect(await store.get(id)).toBeNull();

		await store.close();
	});

	it("works with sqlite file-backed mode", async () => {
		sqliteState.entries.clear();
		const dir = mkdtempSync(join(tmpdir(), "understudy-memory-"));
		const dbPath = join(dir, "memory.db");
		const store = new MemoryStore({ dbPath });
		await store.init();

		const id = await store.add("Persistent memory entry");
		const search = await store.search({ query: "persistent", limit: 10 });
		expect(search.some((m) => m.id === id)).toBe(true);

		await store.close();
		rmSync(dir, { recursive: true, force: true });
	});
});
