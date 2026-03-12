import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../memory/memory-store.js";
import { createMemoryGetTool, createMemoryManageTool, createMemorySearchTool } from "../memory/memory-tool.js";

describe("memory tools", () => {
	let store: MemoryStore;

	beforeEach(async () => {
		store = MemoryStore.inMemory();
		await store.init();
	});

	afterEach(async () => {
		await store.close();
	});

	it("search returns no results text when empty", async () => {
		const tool = createMemorySearchTool(store);
		const result = await tool.execute("id", { query: "understudy" });

		expect((result.content[0] as any).text).toContain("No memories found");
	});

	it("manage add/delete lifecycle while reads go through memory_get", async () => {
		const manage = createMemoryManageTool(store);
		const get = createMemoryGetTool(store);

		const add = await manage.execute("id", {
			action: "add",
			content: "Understudy remembers this",
			metadata: { tag: "test" },
		});
		const addText = (add.content[0] as any).text as string;
		expect(addText).toContain("Memory stored with ID:");
		const id = addText.split("Memory stored with ID:")[1].trim();

		const fetched = await get.execute("id", { id });
		expect((fetched.content[0] as any).text).toContain("Understudy remembers this");

		const del = await manage.execute("id", { action: "delete", id });
		expect((del.content[0] as any).text).toContain("Deleted memory");
	});

	it("returns validation errors for missing inputs and unknown action", async () => {
		const manage = createMemoryManageTool(store);

		const missingAdd = await manage.execute("id", { action: "add" });
		expect((missingAdd.content[0] as any).text).toContain("content required");

		const missingDelete = await manage.execute("id", { action: "delete" });
		expect((missingDelete.content[0] as any).text).toContain("id required");

		const unknown = await manage.execute("id", { action: "noop" });
		expect((unknown.content[0] as any).text).toContain("Unknown action");
	});

	it("memory_get returns found and not-found responses", async () => {
		const id = await store.add("persistent detail");
		const tool = createMemoryGetTool(store);

		const found = await tool.execute("id", { id });
		expect((found.content[0] as any).text).toContain("persistent detail");

		const missing = await tool.execute("id", { id: "missing" });
		expect((missing.content[0] as any).text).toContain("Memory not found");
	});

	it("memory_search returns formatted results", async () => {
		await store.add("Understudy alpha", { scope: "a" });
		await store.add("Understudy beta", { scope: "b" });

		const tool = createMemorySearchTool(store);
		const result = await tool.execute("id", { query: "understudy", limit: 1 });
		const text = (result.content[0] as any).text as string;

		expect(text).toContain("Found 1 memories");
		expect(text).toContain("[mem_");
	});
});
