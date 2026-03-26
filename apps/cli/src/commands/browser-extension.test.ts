import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	buildBrowserExtensionConfigPatch,
	installChromeExtension,
	parseBrowserExtensionSlashCommand,
	resolveBrowserExtensionInstallDir,
} from "./browser-extension.js";
// @ts-expect-error test-only import of raw extension asset module
import { persistBundledInstallDefaults } from "../../../../assets/chrome-extension/install-config.js";

const tempDirs: string[] = [];
const testGlobal = globalThis as typeof globalThis & {
	chrome?: any;
	fetch?: typeof fetch;
};
const originalChrome = testGlobal.chrome;
const originalFetch = globalThis.fetch;

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
	}
	testGlobal.chrome = originalChrome;
	testGlobal.fetch = originalFetch;
});

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("browser extension install", () => {
	it("copies bundled extension assets into a stable install directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "understudy-browser-extension-"));
		tempDirs.push(root);
		const sourceDir = join(root, "source");
		const installDir = join(root, "install");
		await mkdir(sourceDir, { recursive: true });
		await mkdir(join(sourceDir, "icons"), { recursive: true });
		await writeFile(join(sourceDir, "manifest.json"), '{"name":"Understudy Browser Relay"}', "utf8");
		await writeFile(join(sourceDir, "background.js"), "console.log('ok')", "utf8");
		await writeFile(join(sourceDir, "icons", "icon16.png"), "png", "utf8");

		const installed = await installChromeExtension({
			sourceDir,
			installDir,
			seedConfig: {
				relayPort: 24444,
				gatewayToken: "seed-token",
			},
		});

		expect(installed.path).toBe(installDir);
		const manifest = await readFile(join(installDir, "manifest.json"), "utf8");
		expect(manifest).toContain("Understudy Browser Relay");
		const localConfig = JSON.parse(await readFile(join(installDir, "understudy-local-config.json"), "utf8"));
		expect(localConfig).toEqual({
			relayPort: 24444,
			gatewayToken: "seed-token",
		});
	});

	it("defaults the install path to Downloads and respects explicit targets", () => {
		expect(resolveBrowserExtensionInstallDir({
			homeDir: "/Users/test",
		})).toBe("/Users/test/Downloads/Understudy Chrome Extension");
		expect(resolveBrowserExtensionInstallDir({
			homeDir: "/Users/test",
			target: "managed",
		})).toContain(".understudy/browser/chrome-extension");
		expect(resolveBrowserExtensionInstallDir({
			homeDir: "/Users/test",
			target: "/tmp/custom-extension",
		})).toBe("/tmp/custom-extension");
		expect(resolveBrowserExtensionInstallDir({
			config: {
				browser: {
					extension: {
						installDir: "/tmp/from-config",
					},
				},
			} as any,
		})).toBe("/tmp/from-config");
	});

	it("rejects removed legacy install targets", () => {
		expect(() => resolveBrowserExtensionInstallDir({
			homeDir: "/Users/test",
			target: "download",
		})).toThrow('Unsupported browser extension target "download"');
		expect(() => resolveBrowserExtensionInstallDir({
			homeDir: "/Users/test",
			target: "home",
		})).toThrow('Unsupported browser extension target "home"');
	});

	it("builds a browser config patch that enables extension routing after install", () => {
		expect(buildBrowserExtensionConfigPatch({
			installDir: "/tmp/extension",
		})).toEqual({
			browser: {
				connectionMode: "extension",
				cdpUrl: "http://127.0.0.1:23336",
				extension: {
					installDir: "/tmp/extension",
				},
			},
		});
	});

	it("parses slash commands with optional targets", () => {
		expect(parseBrowserExtensionSlashCommand("/browser-extension")).toEqual({
			action: "install",
			target: undefined,
		});
		expect(parseBrowserExtensionSlashCommand("/browser-extension /tmp/custom")).toEqual({
			action: "install",
			target: "/tmp/custom",
		});
		expect(parseBrowserExtensionSlashCommand("/browser-extension install")).toBeUndefined();
		expect(parseBrowserExtensionSlashCommand("/browser-extension install /tmp/custom")).toBeUndefined();
		expect(parseBrowserExtensionSlashCommand("/browser-extension config")).toBeUndefined();
		expect(parseBrowserExtensionSlashCommand("/browser-extension config mode=extension")).toBeUndefined();
		expect(parseBrowserExtensionSlashCommand("/extension")).toBeUndefined();
		expect(parseBrowserExtensionSlashCommand("/extension path managed")).toBeUndefined();
	});

	it("returns merged relay defaults after persisting bundled config", async () => {
		testGlobal.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({
				relayPort: 24444,
				gatewayToken: "seed-token",
			}),
		}) as unknown as Response) as unknown as typeof fetch;
		testGlobal.chrome = {
			runtime: {
				getURL: vi.fn((value: string) => `chrome-extension://test/${value}`),
			},
			storage: {
				local: {
					get: vi.fn(async () => ({
						relayPort: "",
						gatewayToken: "",
					})),
					set: vi.fn(async () => undefined),
				},
			},
		} as any;

		await expect(persistBundledInstallDefaults()).resolves.toEqual({
			relayPort: 24444,
			gatewayToken: "seed-token",
		});
		expect(testGlobal.chrome.storage.local.set).toHaveBeenCalledWith({
			relayPort: 24444,
			gatewayToken: "seed-token",
		});
	});
});
