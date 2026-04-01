export class GuiActionAbortError extends Error {
	override name = "AbortError";

	constructor(message = "The GUI action was aborted.") {
		super(message);
	}
}

export interface GuiActionSessionCleanup {
	name: string;
	fn: () => Promise<void> | void;
	timeoutMs?: number;
}

export interface GuiEmergencyStopHandle {
	stop(): Promise<void> | void;
}

export interface GuiEmergencyStopProvider {
	start(params: {
		toolName: string;
		signal: AbortSignal;
		onEmergencyStop: () => void;
	}): Promise<GuiEmergencyStopHandle | undefined>;
}

function normalizeAbortReason(reason: unknown, fallbackMessage: string): Error {
	if (reason instanceof Error) {
		return reason;
	}
	if (typeof reason === "string" && reason.trim().length > 0) {
		return new GuiActionAbortError(reason);
	}
	return new GuiActionAbortError(fallbackMessage);
}

export async function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) {
		return;
	}
	if (!signal) {
		await new Promise((resolve) => setTimeout(resolve, ms));
		return;
	}
	if (signal.aborted) {
		throw normalizeAbortReason(signal.reason, "The GUI action was aborted.");
	}
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			reject(normalizeAbortReason(signal.reason, "The GUI action was aborted."));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export class GuiActionSession {
	private readonly abortController = new AbortController();
	private readonly cleanups: GuiActionSessionCleanup[] = [];
	private expectedEscapeUntil = 0;
	private readonly externalSignal?: AbortSignal;
	private externalAbortListener?: () => void;

	constructor(
		private readonly toolName: string,
		signal?: AbortSignal,
	) {
		this.externalSignal = signal;
		if (signal) {
			if (signal.aborted) {
				this.abort(signal.reason);
			} else {
				this.externalAbortListener = () => {
					this.abort(signal.reason);
				};
				signal.addEventListener("abort", this.externalAbortListener, { once: true });
			}
		}
	}

	get signal(): AbortSignal {
		return this.abortController.signal;
	}

	registerCleanup(name: string, fn: () => Promise<void> | void, timeoutMs = 5_000): void {
		this.cleanups.push({ name, fn, timeoutMs });
	}

	abort(reason?: unknown): void {
		if (!this.abortController.signal.aborted) {
			this.abortController.abort(
				normalizeAbortReason(reason, `GUI ${this.toolName} was aborted.`),
			);
		}
	}

	throwIfAborted(): void {
		if (this.abortController.signal.aborted) {
			throw normalizeAbortReason(
				this.abortController.signal.reason,
				`GUI ${this.toolName} was aborted.`,
			);
		}
	}

	notifyExpectedEscape(windowMs = 100): void {
		this.expectedEscapeUntil = Date.now() + Math.max(0, windowMs);
	}

	handleEmergencyStop(): boolean {
		if (Date.now() <= this.expectedEscapeUntil) {
			return false;
		}
		this.abort("GUI action aborted after Escape was pressed.");
		return true;
	}

	async sleep(ms: number): Promise<void> {
		await sleepWithSignal(ms, this.signal);
	}

	async cleanup(): Promise<void> {
		if (this.externalSignal && this.externalAbortListener) {
			this.externalSignal.removeEventListener("abort", this.externalAbortListener);
			this.externalAbortListener = undefined;
		}
		const cleanups = this.cleanups.splice(0).reverse();
		for (const cleanup of cleanups) {
			await Promise.race([
				Promise.resolve().then(async () => {
					await cleanup.fn();
				}),
				new Promise<void>((_, reject) => {
					setTimeout(() => {
						reject(new Error(`cleanup timed out: ${cleanup.name}`));
					}, cleanup.timeoutMs ?? 5_000);
				}),
			]).catch(() => {});
		}
	}
}
