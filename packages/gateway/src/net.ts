/**
 * Network utilities for gateway.
 * Client IP resolution, loopback detection, IP normalization.
 */

import type { Request } from "express";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

/**
 * Normalize an IP address string.
 * Strips IPv6 prefix from IPv4-mapped addresses and lowercases.
 */
export function normalizeIp(ip: string): string {
	let normalized = ip.trim().toLowerCase();
	// Strip IPv4-mapped IPv6 prefix
	if (normalized.startsWith("::ffff:")) {
		const v4 = normalized.slice(7);
		// Only strip if it looks like an IPv4 address
		if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)) {
			normalized = v4;
		}
	}
	return normalized;
}

/**
 * Check if an address is a loopback address.
 */
export function isLoopbackAddress(ip: string): boolean {
	const normalized = normalizeIp(ip);
	return LOOPBACK_ADDRESSES.has(normalized) || normalized.startsWith("127.");
}

/**
 * Resolve the real client IP from request, accounting for trusted proxies.
 * Only trusts X-Forwarded-For if the immediate connection is from a trusted proxy.
 */
export function resolveClientIp(req: Request, trustedProxies?: string[]): string {
	const socketIp = normalizeIp(req.socket.remoteAddress ?? "127.0.0.1");

	if (!trustedProxies || trustedProxies.length === 0) {
		return socketIp;
	}

	// Normalize trusted proxy list
	const trusted = new Set(trustedProxies.map(normalizeIp));

	// Only parse X-Forwarded-For if connected through a trusted proxy
	if (!trusted.has(socketIp) && !isLoopbackAddress(socketIp)) {
		return socketIp;
	}

	const xForwardedFor = req.headers["x-forwarded-for"];
	if (!xForwardedFor) {
		return socketIp;
	}

	const forwarded = typeof xForwardedFor === "string" ? xForwardedFor : xForwardedFor[0];
	if (!forwarded) return socketIp;

	// Take the leftmost (client-originating) IP
	const parts = forwarded.split(",").map((s) => normalizeIp(s));
	// Walk from right to left, stopping at first untrusted IP
	for (let i = parts.length - 1; i >= 0; i--) {
		if (!trusted.has(parts[i]) && !isLoopbackAddress(parts[i])) {
			return parts[i];
		}
	}

	return parts[0] || socketIp;
}
