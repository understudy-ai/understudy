import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createApplyPatchTool } from "../apply-patch-tool.js";

describe("createApplyPatchTool", () => {
	it("adds and updates files from patch hunks", async () => {
		const root = await mkdtemp(join(tmpdir(), "understudy-apply-patch-"));
		await writeFile(join(root, "a.txt"), "line1\nline2\n", "utf8");

		const patch = [
			"*** Begin Patch",
			"*** Add File: b.txt",
			"+hello",
			"+world",
			"*** Update File: a.txt",
			"@@ line1",
			"-line2",
			"+line2-updated",
			"*** End Patch",
		].join("\n");

		const tool = createApplyPatchTool({ cwd: root });
		const result = await tool.execute("id", { input: patch });
		const text = (result.content[0] as any).text;
		expect(text).toContain("A b.txt");
		expect(text).toContain("M a.txt");

		await expect(readFile(join(root, "b.txt"), "utf8")).resolves.toBe("hello\nworld\n");
		await expect(readFile(join(root, "a.txt"), "utf8")).resolves.toContain("line2-updated");
	});

	it("deletes files", async () => {
		const root = await mkdtemp(join(tmpdir(), "understudy-apply-patch-"));
		await writeFile(join(root, "remove.txt"), "bye\n", "utf8");

		const patch = [
			"*** Begin Patch",
			"*** Delete File: remove.txt",
			"*** End Patch",
		].join("\n");

		const tool = createApplyPatchTool({ cwd: root });
		const result = await tool.execute("id", { input: patch });
		expect((result.content[0] as any).text).toContain("D remove.txt");
		await expect(readFile(join(root, "remove.txt"), "utf8")).rejects.toBeTruthy();
	});

	it("blocks workspace traversal by default", async () => {
		const root = await mkdtemp(join(tmpdir(), "understudy-apply-patch-"));
		const tool = createApplyPatchTool({ cwd: root, workspaceOnly: true });

		const patch = [
			"*** Begin Patch",
			"*** Add File: ../outside.txt",
			"+forbidden",
			"*** End Patch",
		].join("\n");

		const result = await tool.execute("id", { input: patch });
		expect((result.content[0] as any).text).toContain("Path escapes workspace root");
	});
});
