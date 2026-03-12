/**
 * Memory store backed by SQLite, with an in-memory mode for tests.
 */

import type { MemoryProvider } from "./provider.js";

export interface MemoryEntry {
	id: string;
	content: string;
	metadata?: Record<string, unknown>;
	embedding?: number[];
	createdAt: number;
	updatedAt: number;
}

export interface MemorySearchOptions {
	query: string;
	limit?: number;
	filter?: Record<string, unknown>;
}

export interface MemoryStoreOptions {
	dbPath: string;
}

export class MemoryStore implements MemoryProvider {
	private db: any = null;
	private dbPath: string;
	private initialized = false;
	private mode: "sqlite" | "memory" = "memory";
	private entries: MemoryEntry[] = [];

	constructor(options: MemoryStoreOptions) {
		this.dbPath = options.dbPath;
	}

	/** Create an in-memory store (for testing) */
	static inMemory(): MemoryStore {
		return new MemoryStore({ dbPath: ":memory:" });
	}

	/** Initialize the database */
	async init(): Promise<void> {
		if (this.initialized) return;

		if (this.dbPath === ":memory:") {
			this.mode = "memory";
			this.entries = [];
			this.initialized = true;
			return;
		}

		const { default: Database } = await import("better-sqlite3" as string);
		this.db = new Database(this.dbPath);
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS memories (
				id TEXT PRIMARY KEY,
				content TEXT NOT NULL,
				metadata TEXT,
				embedding BLOB,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);

			CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
				content,
				content='memories',
				content_rowid='rowid'
			);

			CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
				INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
			END;

			CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
				INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
			END;

			CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
				INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
				INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
			END;
		`);
		this.mode = "sqlite";
		this.initialized = true;
	}

	/** Add a memory entry */
	async add(content: string, metadata?: Record<string, unknown>): Promise<string> {
		this.ensureInit();
		const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		const now = Date.now();

		if (this.mode === "sqlite") {
			this.db.prepare(
				"INSERT INTO memories (id, content, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			).run(id, content, metadata ? JSON.stringify(metadata) : null, now, now);
			return id;
		}

		this.entries.push({
			id,
			content,
			metadata,
			createdAt: now,
			updatedAt: now,
		});

		return id;
	}

	/** Get a memory by ID */
	async get(id: string): Promise<MemoryEntry | null> {
		this.ensureInit();
		if (this.mode === "sqlite") {
			const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id);
			return row ? this.rowToEntry(row) : null;
		}
		return this.entries.find((e) => e.id === id) ?? null;
	}

	/** Search memories using FTS5 */
	async search(options: MemorySearchOptions): Promise<MemoryEntry[]> {
		this.ensureInit();
		const limit = options.limit ?? 10;
		const query = options.query.trim();

		if (!query) {
			if (this.mode === "sqlite") {
				const rows = this.db.prepare(`
					SELECT * FROM memories
					ORDER BY updated_at DESC
					LIMIT ?
				`).all(limit);
				return rows.map((row: any) => this.rowToEntry(row));
			}
			return this.entries
				.slice()
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.slice(0, limit);
		}

		if (this.mode === "sqlite") {
			const rows = this.db.prepare(`
				SELECT m.* FROM memories m
				JOIN memories_fts f ON m.rowid = f.rowid
				WHERE memories_fts MATCH ?
				ORDER BY rank
				LIMIT ?
			`).all(query, limit);

			return rows.map((row: any) => this.rowToEntry(row));
		}

		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		return this.entries
			.map((entry) => ({
				entry,
				score: this.scoreEntry(entry, terms),
			}))
			.filter((x) => x.score > 0)
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				return b.entry.updatedAt - a.entry.updatedAt;
			})
			.slice(0, limit)
			.map((x) => x.entry);
	}

	/** Delete a memory */
	async delete(id: string): Promise<boolean> {
		this.ensureInit();
		if (this.mode === "sqlite") {
			const result = this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
			return result.changes > 0;
		}

		const before = this.entries.length;
		this.entries = this.entries.filter((e) => e.id !== id);
		return this.entries.length !== before;
	}

	/** Close the database */
	async close(): Promise<void> {
		if (this.mode === "sqlite" && this.db) {
			this.db.close();
			this.db = null;
		}
		this.initialized = false;
	}

	private ensureInit(): void {
		if (!this.initialized) {
			throw new Error("MemoryStore not initialized. Call init() first.");
		}
	}

	private scoreEntry(entry: MemoryEntry, terms: string[]): number {
		const haystack = `${entry.content}\n${entry.metadata ? JSON.stringify(entry.metadata) : ""}`.toLowerCase();
		let score = 0;
		for (const term of terms) {
			const idx = haystack.indexOf(term);
			if (idx === -1) continue;
			score += 1;
			let pos = idx + term.length;
			while (pos >= term.length) {
				const next = haystack.indexOf(term, pos);
				if (next === -1) break;
				score += 1;
				pos = next + term.length;
			}
		}
		return score;
	}

	private rowToEntry(row: any): MemoryEntry {
		return {
			id: row.id,
			content: row.content,
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}
}
