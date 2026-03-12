/**
 * MessageRouter: routes messages between channels and agent sessions.
 */

import type {
	ChannelAdapter,
	ChannelRuntimeStatus,
	ChannelRuntimeStatusPatch,
	InboundMessage,
} from "@understudy/types";
import { PairingManager } from "./security.js";
import { createLogger } from "@understudy/core";
import { normalizeComparableText } from "./value-coerce.js";

export interface RouteHandler {
	(message: InboundMessage): Promise<void>;
}

export interface MessageRouterOptions {
	pairingManager?: PairingManager;
	requirePairing?: boolean;
	autoRestart?: boolean;
	restartBaseDelayMs?: number;
	restartMaxDelayMs?: number;
	dedupeTtlMs?: number;
}

const DEFAULT_DEDUPE_TTL_MS = 120_000;
const FALLBACK_TEXT_BUCKET_MS = 5_000;

function buildDedupeKey(message: InboundMessage): string {
	if (message.externalMessageId) {
		return [
			"external",
			message.channelId,
			message.senderId,
			message.threadId ?? "",
			message.externalMessageId,
		].join(":");
	}

	const attachmentKey = (message.attachments ?? [])
		.map((attachment) => `${attachment.type}:${attachment.name ?? attachment.url}`)
		.join("|");
	const normalizedText = normalizeComparableText(message.text);
	const bucket = Math.floor((message.timestamp || Date.now()) / FALLBACK_TEXT_BUCKET_MS);
	return [
		"fallback",
		message.channelId,
		message.senderId,
		message.threadId ?? "",
		message.replyToMessageId ?? "",
		normalizedText,
		attachmentKey,
		String(bucket),
	].join(":");
}

export class MessageRouter {
	private channels = new Map<string, ChannelAdapter>();
	private handler: RouteHandler | null = null;
	private pairingManager?: PairingManager;
	private requirePairing: boolean;
	private unsubscribes: Array<() => void> = [];
	private logger = createLogger("MessageRouter");
	private running = false;
	private autoRestart: boolean;
	private restartBaseDelayMs: number;
	private restartMaxDelayMs: number;
	private restartTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private restartAttempts = new Map<string, number>();
	private dedupeTtlMs: number;
	private recentInbound = new Map<string, number>();
	private channelStatuses = new Map<string, ChannelRuntimeStatus>();

	constructor(options: MessageRouterOptions = {}) {
		this.pairingManager = options.pairingManager;
		this.requirePairing = options.requirePairing ?? false;
		this.autoRestart = options.autoRestart !== false;
		this.restartBaseDelayMs = Math.max(0, options.restartBaseDelayMs ?? 2000);
		this.restartMaxDelayMs = Math.max(this.restartBaseDelayMs, options.restartMaxDelayMs ?? 30000);
		this.dedupeTtlMs = Math.max(1_000, options.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS);
	}

	/** Register a channel adapter */
	addChannel(channel: ChannelAdapter): void {
		this.channels.set(channel.id, channel);
		this.setChannelStatus(channel, {
			state: "stopped",
			summary: "Registered",
		});

		const unsub = channel.messaging.onMessage((message) => {
			this.routeInbound(message).catch((error) => {
				this.logger.error(`Route error for ${channel.id}`, {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		});

		this.unsubscribes.push(unsub);
	}

	/** Remove a channel */
	removeChannel(channelId: string): void {
		const channel = this.channels.get(channelId);
		this.channels.delete(channelId);
		const timer = this.restartTimers.get(channelId);
		if (timer) {
			clearTimeout(timer);
			this.restartTimers.delete(channelId);
		}
		this.restartAttempts.delete(channelId);
		if (channel) {
			this.setChannelStatus(channel, {
				state: "stopped",
				summary: "Removed",
				restartAttempt: 0,
			});
		}
	}

	/** Get a channel by ID */
	getChannel(channelId: string): ChannelAdapter | undefined {
		return this.channels.get(channelId);
	}

	/** List all registered channels */
	listChannels(): ChannelAdapter[] {
		return Array.from(this.channels.values());
	}

	async getChannelRuntimeStatus(channelId: string): Promise<ChannelRuntimeStatus | undefined> {
		const channel = this.channels.get(channelId);
		if (!channel) return undefined;
		return await this.resolveChannelRuntimeStatus(channel);
	}

	async listChannelRuntimeStatuses(): Promise<Array<{ channel: ChannelAdapter; runtime: ChannelRuntimeStatus }>> {
		const channels = this.listChannels();
		const runtimes = await Promise.all(
			channels.map(async (channel) => ({
				channel,
				runtime: await this.resolveChannelRuntimeStatus(channel),
			})),
		);
		return runtimes;
	}

	/** Set the handler for routed messages */
	onMessage(handler: RouteHandler): void {
		this.handler = handler;
	}

	/** Start all channels */
	async startAll(): Promise<void> {
		this.running = true;
		await Promise.all(
			Array.from(this.channels.keys()).map((channelId) => this.startChannel(channelId)),
		);
	}

	/** Stop all channels */
	async stopAll(): Promise<void> {
		this.running = false;
		for (const timer of this.restartTimers.values()) {
			clearTimeout(timer);
		}
		this.restartTimers.clear();
		this.restartAttempts.clear();
		this.recentInbound.clear();

		for (const unsub of this.unsubscribes) {
			unsub();
		}
		this.unsubscribes = [];

		await Promise.allSettled(
			Array.from(this.channels.values()).map(async (ch) => {
				try {
					await ch.stop();
				} finally {
					this.setChannelStatus(ch, {
						state: "stopped",
						summary: "Stopped",
						restartAttempt: 0,
					});
				}
			}),
		);
	}

	private async startChannel(channelId: string): Promise<void> {
		const channel = this.channels.get(channelId);
		if (!channel) return;
		this.setChannelStatus(channel, {
			state: "starting",
			summary: "Starting",
			lastError: undefined,
		});
		try {
			await channel.start();
			this.restartAttempts.set(channelId, 0);
			this.setChannelStatus(channel, {
				state: "running",
				summary: "Running",
				lastError: undefined,
				restartAttempt: 0,
			});
			this.logger.info(`Channel started: ${channel.id}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setChannelStatus(channel, {
				state: "error",
				summary: "Start failed",
				lastError: message,
			});
			this.logger.error(`Failed to start channel: ${channel.id}`, { error: message });
			this.scheduleRestart(channel.id);
		}
	}

	private scheduleRestart(channelId: string): void {
		if (!this.running || !this.autoRestart) {
			return;
		}
		if (this.restartTimers.has(channelId)) {
			return;
		}
		const nextAttempt = (this.restartAttempts.get(channelId) ?? 0) + 1;
		this.restartAttempts.set(channelId, nextAttempt);

		const exponentialDelay =
			this.restartBaseDelayMs === 0
				? 0
				: this.restartBaseDelayMs * 2 ** Math.max(0, nextAttempt - 1);
		const delayMs = Math.min(this.restartMaxDelayMs, exponentialDelay);
		const channel = this.channels.get(channelId);
		if (channel) {
			this.setChannelStatus(channel, {
				state: "reconnecting",
				summary: delayMs > 0 ? `Retrying in ${delayMs}ms` : "Retrying now",
				restartAttempt: nextAttempt,
			});
		}
		this.logger.warn(`Scheduling channel restart: ${channelId}`, {
			attempt: nextAttempt,
			delayMs,
		});

		const timer = setTimeout(() => {
			this.restartTimers.delete(channelId);
			this.startChannel(channelId).catch((error) => {
				this.logger.error(`Channel restart error: ${channelId}`, {
					error: error instanceof Error ? error.message : String(error),
				});
			});
		}, delayMs);
		this.restartTimers.set(channelId, timer);
	}

	private async routeInbound(message: InboundMessage): Promise<void> {
		if (this.isDuplicate(message)) {
			this.logger.info(`Dropped duplicate inbound message for ${message.channelId}:${message.senderId}`, {
				externalMessageId: message.externalMessageId,
			});
			return;
		}

		// Check pairing/allowlist if required
		if (this.requirePairing && this.pairingManager) {
			if (!this.pairingManager.isAllowed(message.channelId, message.senderId)) {
				// Let pairing manager decide whether this message is a valid approval attempt.
				const approved = this.pairingManager.approve(
					message.text,
					message.channelId,
					message.senderId,
				);
				if (approved) {
					this.logger.info(`Pairing approved for ${message.channelId}:${message.senderId}`);
					// Send ack through the channel
					const channel = this.channels.get(message.channelId);
					if (channel) {
						await channel.messaging.sendMessage({
							channelId: message.channelId,
							recipientId: message.senderId,
							text: "Pairing successful! You can now send messages.",
						});
					}
					return;
				}

				this.logger.warn(`Unauthorized message from ${message.channelId}:${message.senderId}`);
				return;
			}
		}

		if (this.handler) {
			await this.handler(message);
		} else {
			this.logger.warn("No message handler registered");
		}
	}

	private isDuplicate(message: InboundMessage): boolean {
		const now = Date.now();
		for (const [key, expiresAt] of this.recentInbound.entries()) {
			if (expiresAt <= now) {
				this.recentInbound.delete(key);
			}
		}

		const key = buildDedupeKey(message);
		const expiresAt = this.recentInbound.get(key);
		if (expiresAt && expiresAt > now) {
			return true;
		}
		this.recentInbound.set(key, now + this.dedupeTtlMs);
		return false;
	}

	private async resolveChannelRuntimeStatus(channel: ChannelAdapter): Promise<ChannelRuntimeStatus> {
		if (typeof channel.getRuntimeStatus === "function") {
			return await channel.getRuntimeStatus();
		}
		return this.channelStatuses.get(channel.id) ?? {
			state: "stopped",
			summary: "Unknown",
			updatedAt: Date.now(),
		};
	}

	private setChannelStatus(
		channel: ChannelAdapter,
		patch: ChannelRuntimeStatusPatch & { state: NonNullable<ChannelRuntimeStatusPatch["state"]> },
	): void {
		const current = this.channelStatuses.get(channel.id);
		const next: ChannelRuntimeStatus = {
			state: patch.state,
			updatedAt: patch.updatedAt ?? Date.now(),
			startedAt:
				patch.startedAt !== undefined
					? patch.startedAt
					: patch.state === "running"
						? current?.startedAt ?? Date.now()
						: patch.state === "starting"
							? current?.startedAt ?? Date.now()
							: patch.state === "stopped"
								? undefined
								: current?.startedAt,
			summary: patch.summary ?? current?.summary,
			lastError: patch.lastError ?? current?.lastError,
			restartAttempt: patch.restartAttempt ?? current?.restartAttempt,
			details: patch.details ?? current?.details,
		};
		this.channelStatuses.set(channel.id, next);
		channel.updateRuntimeStatus?.(patch);
	}
}
