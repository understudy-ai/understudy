import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { mountControlUi } from "../control-ui.js";

const cleanupDirs: string[] = [];

async function withMountedApp(
	configure: (app: express.Express) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
	const app = express();
	configure(app);
	const server = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
		const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
	});
	const address = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: async () =>
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

afterEach(async () => {
	await Promise.all(cleanupDirs.splice(0).map(async (dir) => {
		await rm(dir, { recursive: true, force: true });
	}));
});

describe("mountControlUi", () => {
	it("serves config and SPA routes under the configured base path", async () => {
		const mounted = await withMountedApp((app) => {
			mountControlUi(app, {
				basePath: "/admin/",
				assistantName: "TestBot",
				assistantAvatarUrl: "https://example.com/avatar.png?size=64",
			});
		});

		try {
			const configRes = await fetch(`${mounted.baseUrl}/admin/config.json`);
			expect(configRes.status).toBe(200);
			expect(await configRes.json()).toEqual({
				assistantName: "TestBot",
				assistantAvatarUrl: "https://example.com/avatar.png?size=64",
				basePath: "/admin",
			});

			const htmlRes = await fetch(`${mounted.baseUrl}/admin/inspections/live`);
			expect(htmlRes.status).toBe(200);
			const html = await htmlRes.text();
			expect(html).toContain("<title>TestBot Dashboard</title>");
			expect(html).toContain("https://example.com/avatar.png?size=64");
			expect(html).toContain("Runtime Readiness");
			expect(html).toContain("Channel Operations");
				expect(html).toContain("Runs");
			expect(html).toContain("Execution Trace");
			expect(html).toContain('class="chip-row"');
			expect(html).toContain("function sessionChipRowHtml");
		} finally {
			await mounted.close();
		}
	});

	it("applies CORS headers only for allowed origins", async () => {
		const mounted = await withMountedApp((app) => {
			mountControlUi(app, {
				allowedOrigins: ["http://localhost:3000"],
			});
		});

		try {
			const allowed = await fetch(`${mounted.baseUrl}/ui/config.json`, {
				headers: { origin: "http://localhost:3000" },
			});
			expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
			expect(allowed.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");

			const denied = await fetch(`${mounted.baseUrl}/ui/config.json`, {
				headers: { origin: "https://example.com" },
			});
			expect(denied.headers.get("access-control-allow-origin")).toBeNull();
		} finally {
			await mounted.close();
		}
	});

	it("serves custom static assets before falling back to the embedded SPA", async () => {
		const assetRoot = await mkdtemp(join(tmpdir(), "understudy-control-ui-"));
		cleanupDirs.push(assetRoot);
		await writeFile(join(assetRoot, "hello.txt"), "from custom assets", "utf8");

		const mounted = await withMountedApp((app) => {
			mountControlUi(app, {
				basePath: "/ops",
				assetRoot,
				assistantName: "OpsBot",
			});
		});

		try {
			const staticRes = await fetch(`${mounted.baseUrl}/ops/hello.txt`);
			expect(staticRes.status).toBe(200);
			expect(await staticRes.text()).toBe("from custom assets");

			const fallbackRes = await fetch(`${mounted.baseUrl}/ops/sessions/run-1`);
			expect(fallbackRes.status).toBe(200);
			expect(await fallbackRes.text()).toContain("<title>OpsBot Dashboard</title>");
		} finally {
			await mounted.close();
		}
	});
});
