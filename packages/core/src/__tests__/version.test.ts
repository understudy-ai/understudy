import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveUnderstudyPackageVersion } from "../version.js";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.allSettled(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveUnderstudyPackageVersion", () => {
	it("prefers the root published package version over nested workspace package versions", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "understudy-version-"));
		tempDirs.push(rootDir);
		const nestedDir = join(rootDir, "packages", "gateway", "dist");
		await mkdir(nestedDir, { recursive: true });
		await writeFile(
			join(rootDir, "package.json"),
			JSON.stringify({ name: "@understudy-ai/understudy", version: "2.3.4" }),
			"utf8",
		);
		await writeFile(
			join(rootDir, "packages", "gateway", "package.json"),
			JSON.stringify({ name: "@understudy/gateway", version: "0.1.0" }),
			"utf8",
		);

		expect(resolveUnderstudyPackageVersion(nestedDir)).toBe("2.3.4");
	});

	it("falls back to the CLI workspace package when no root package is present", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "understudy-version-"));
		tempDirs.push(rootDir);
		const nestedDir = join(rootDir, "apps", "cli", "dist");
		await mkdir(nestedDir, { recursive: true });
		await writeFile(
			join(rootDir, "apps", "cli", "package.json"),
			JSON.stringify({ name: "@understudy/cli", version: "1.2.4" }),
			"utf8",
		);

		expect(resolveUnderstudyPackageVersion(nestedDir)).toBe("1.2.4");
	});
});
