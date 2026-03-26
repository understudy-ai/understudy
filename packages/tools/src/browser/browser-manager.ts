/**
 * Browser lifecycle management.
 * Uses a normal Playwright browser for the managed path and CDP attach for the
 * Chrome extension relay path.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_BROWSER_EXTENSION_CDP_URL } from "@understudy/types";
import { getUnderstudyChromeExtensionRelayAuthHeaders } from "./extension-relay-auth.js";

type BrowserConnectionMode = "managed" | "extension" | "auto";
type ResolvedBrowserConnectionMode = Exclude<BrowserConnectionMode, "auto">;

export interface BrowserManagerOptions {
	headless?: boolean;
	viewport?: { width: number; height: number };
	timeout?: number;
	browserConnectionMode?: BrowserConnectionMode;
	browserCdpUrl?: string;
}

export interface BrowserTabSummary {
	id: string;
	url: string;
	title?: string;
	active: boolean;
}

function resolveConnectionMode(explicitMode?: BrowserConnectionMode): BrowserConnectionMode {
	const normalized = (explicitMode || process.env.UNDERSTUDY_BROWSER_CONNECTION_MODE || "").trim().toLowerCase();
	if (normalized === "auto") {
		return "auto";
	}
	if (normalized === "extension") {
		return "extension";
	}
	if (normalized === "managed") {
		return "managed";
	}
	return "auto";
}

function resolveExtensionCdpUrl(explicitUrl?: string): string {
	return explicitUrl?.trim() || process.env.UNDERSTUDY_BROWSER_CDP_URL?.trim() || DEFAULT_BROWSER_EXTENSION_CDP_URL;
}

export class BrowserManager {
	private browser: any = null;
	private context: any = null;
	private page: any = null;
	private launching: Promise<void> | null = null;
	private tabIds = new WeakMap<object, string>();
	private nextTabId = 1;
	private activeTabId: string | null = null;
	private resolvedConnectionMode: ResolvedBrowserConnectionMode | null = null;
	private options: Required<Pick<BrowserManagerOptions, "headless" | "viewport" | "timeout">> & {
		browserConnectionMode: BrowserConnectionMode;
		browserCdpUrl: string;
	};

	constructor(options: BrowserManagerOptions = {}) {
		this.options = {
			headless: options.headless ?? true,
			viewport: options.viewport ?? { width: 1280, height: 720 },
			timeout: options.timeout ?? 30_000,
			browserConnectionMode: resolveConnectionMode(options.browserConnectionMode),
			browserCdpUrl: resolveExtensionCdpUrl(options.browserCdpUrl),
		};
	}

	private resetBrowserState(): void {
		this.browser = null;
		this.context = null;
		this.page = null;
		this.activeTabId = null;
		this.resolvedConnectionMode = null;
	}

	private async connectExtensionContext(chromium: any): Promise<void> {
		const headers = await getUnderstudyChromeExtensionRelayAuthHeaders(this.options.browserCdpUrl);
		this.browser = await chromium.connectOverCDP(this.options.browserCdpUrl, {
			timeout: this.options.timeout,
			...(Object.keys(headers).length > 0 ? { headers } : {}),
		});
		this.context = this.browser.contexts?.()[0] ?? null;
		if (!this.context) {
			await this.browser.close?.().catch(() => {});
			this.browser = null;
			throw new Error(
				"Browser extension relay connected but no tab context is attached. Click the Understudy extension on a browser tab first.",
			);
		}
		this.resolvedConnectionMode = "extension";
	}

	private async launchManagedContext(chromium: any): Promise<void> {
		this.browser = await chromium.launch({
			headless: this.options.headless,
		});
		this.context = await this.browser.newContext({
			viewport: this.options.viewport,
		});
		this.resolvedConnectionMode = "managed";
	}

	private async ensureContext(): Promise<void> {
		if (this.context) {
			return;
		}
		if (this.launching) {
			await this.launching;
			return;
		}

		this.launching = (async () => {
			const { chromium } = await import("playwright" as string) as any;
			if (this.options.browserConnectionMode === "extension") {
				await this.connectExtensionContext(chromium);
				return;
			}

			if (this.options.browserConnectionMode === "auto") {
				try {
					await this.connectExtensionContext(chromium);
					return;
				} catch {
					this.resetBrowserState();
				}
			}

			await this.launchManagedContext(chromium);
		})().finally(() => {
			this.launching = null;
		});

		await this.launching;
	}

	private async applyPageDefaults(page: any): Promise<void> {
		page.setDefaultTimeout?.(this.options.timeout);
		if ((this.resolvedConnectionMode ?? this.options.browserConnectionMode) === "managed") {
			await Promise.resolve(page.setViewportSize?.(this.options.viewport)).catch(() => {});
		}
	}

	private async createInitialPage(): Promise<any> {
		await this.ensureContext();
		const existingPages = this.context.pages?.() ?? [];
		this.page = existingPages[0] ?? await this.context.newPage();
		await this.applyPageDefaults(this.page);
		this.ensureTabId(this.page);
		return this.page;
	}

	/** Get or create a page (lazy init) */
	async getPage(targetId?: string): Promise<any> {
		if (targetId?.trim()) {
			await this.focusTab(targetId.trim());
			return this.page;
		}
		if (this.page) {
			return this.page;
		}
		return this.createInitialPage();
	}

	/** Start browser runtime if not running */
	async start(): Promise<void> {
		await this.getPage();
	}

	/** Return active page */
	getCurrentPage(): any {
		return this.page;
	}

	/** Create a new tab and optionally navigate */
	async createTab(url?: string): Promise<BrowserTabSummary> {
		await this.ensureContext();
		const page = await this.context.newPage();
		await this.applyPageDefaults(page);
		if (url) {
			await page.goto(url, { waitUntil: "domcontentloaded" });
		}
		this.page = page;
		const tabId = this.ensureTabId(page);
		return {
			id: tabId,
			url: page.url?.() ?? "",
			title: await page.title?.(),
			active: true,
		};
	}

	/** Focus tab by Understudy tab id */
	async focusTab(tabId: string): Promise<void> {
		await this.ensureContext();
		const pages = this.context.pages?.() ?? [];
		for (const page of pages) {
			if (this.ensureTabId(page) !== tabId) {
				continue;
			}
			this.page = page;
			this.activeTabId = tabId;
			await page.bringToFront?.().catch(() => {});
			return;
		}
		throw new Error(`Tab not found: ${tabId}`);
	}

	/** List all tabs in the current browser context */
	async listTabs(): Promise<BrowserTabSummary[]> {
		await this.ensureContext();
		const pages = this.context.pages?.() ?? [];
		const active = this.activeTabId ?? (this.page ? this.ensureTabId(this.page) : null);
		const summaries: BrowserTabSummary[] = [];
		for (const page of pages) {
			const tabId = this.ensureTabId(page);
			summaries.push({
				id: tabId,
				url: page.url?.() ?? "",
				title: await page.title?.(),
				active: tabId === active,
			});
		}
		return summaries;
	}

	/** Close a tab by id; if omitted, closes the active tab */
	async closeTab(tabId?: string): Promise<void> {
		await this.ensureContext();
		const pages = this.context.pages?.() ?? [];
		if (pages.length === 0) {
			return;
		}
		let target = this.page;
		if (tabId) {
			target = pages.find((page: any) => this.ensureTabId(page) === tabId);
		}
		if (!target) {
			throw new Error(`Tab not found: ${tabId}`);
		}
		await target.close().catch(() => {});
		const remaining = this.context.pages?.() ?? [];
		this.page = remaining[0] ?? null;
		this.activeTabId = this.page ? this.ensureTabId(this.page) : null;
		if (!this.page) {
			await this.close();
		}
	}

	/** Check if browser is running */
	isRunning(): boolean {
		return this.context !== null;
	}

	getConfiguredConnectionMode(): BrowserConnectionMode {
		return this.options.browserConnectionMode;
	}

	getResolvedConnectionMode(): ResolvedBrowserConnectionMode | null {
		return this.resolvedConnectionMode;
	}

	/** Close the browser */
	async close(): Promise<void> {
		const browser = this.browser;
		this.resetBrowserState();
		if (browser) {
			await browser.close?.().catch(() => {});
		}
	}

	/** Take a screenshot and return as base64 */
	async screenshot(): Promise<string> {
		const page = await this.getPage();
		const buffer = await page.screenshot({ type: "png" });
		return buffer.toString("base64");
	}

	/** Save current page as PDF and return file path */
	async savePdf(filePath?: string): Promise<string> {
		const page = await this.getPage();
		const targetPath =
			filePath?.trim() ||
			join(tmpdir(), `understudy-browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
		await page.pdf({ path: targetPath, printBackground: true });
		return targetPath;
	}

	getTabId(page: any): string {
		return this.ensureTabId(page);
	}

	private ensureTabId(page: any): string {
		const key = page as object;
		const existing = this.tabIds.get(key);
		if (existing) {
			return existing;
		}
		const id = `tab_${this.nextTabId++}`;
		this.tabIds.set(key, id);
		return id;
	}
}
