/**
 * Gateway authentication system.
 * Supports "none", "token", and "password" modes.
 */

import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { GatewayAuthConfig } from "@understudy/types";
import type { AuthRateLimiter } from "./rate-limiter.js";
import { resolveClientIp } from "./net.js";

export type GatewayAuthMode = "none" | "token" | "password";
export type { GatewayAuthConfig } from "@understudy/types";

export interface AuthMiddlewareOptions {
	auth: GatewayAuthConfig;
	rateLimiter?: AuthRateLimiter;
	trustedProxies?: string[];
}

/**
 * Resolve the effective auth config from config + environment variables.
 * Environment variables take precedence.
 */
export function resolveGatewayAuth(configAuth?: Partial<GatewayAuthConfig>): GatewayAuthConfig {
	const envMode = process.env.UNDERSTUDY_GATEWAY_AUTH_MODE?.trim().toLowerCase() as GatewayAuthMode | undefined;
	const envToken = process.env.UNDERSTUDY_GATEWAY_TOKEN?.trim();
	const envPassword = process.env.UNDERSTUDY_GATEWAY_PASSWORD?.trim();

	const mode = envMode ?? configAuth?.mode ?? "none";
	const token = envToken ?? configAuth?.token;
	const password = envPassword ?? configAuth?.password;

	return { mode, token, password };
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
export function safeEqualSecret(a: string, b: string): boolean {
	if (typeof a !== "string" || typeof b !== "string") return false;
	const bufA = Buffer.from(a, "utf-8");
	const bufB = Buffer.from(b, "utf-8");
	// Pad to equal length to prevent leaking secret length via timing
	const maxLen = Math.max(bufA.length, bufB.length, 1);
	const padA = Buffer.concat([bufA, Buffer.alloc(maxLen - bufA.length)]);
	const padB = Buffer.concat([bufB, Buffer.alloc(maxLen - bufB.length)]);
	const equal = timingSafeEqual(padA, padB);
	return equal && bufA.length === bufB.length;
}

/**
 * Authorize a gateway request based on auth mode.
 * Returns null if authorized, or an error message string if not.
 */
export function authorizeGatewayRequest(
	auth: GatewayAuthConfig,
	providedCredential?: string,
): string | null {
	if (auth.mode === "none") return null;

	if (!providedCredential) {
		return "Authentication required";
	}

	if (auth.mode === "token") {
		if (!auth.token) return "Server auth token not configured";
		if (!safeEqualSecret(providedCredential, auth.token)) {
			return "Invalid token";
		}
		return null;
	}

	if (auth.mode === "password") {
		if (!auth.password) return "Server auth password not configured";
		if (!safeEqualSecret(providedCredential, auth.password)) {
			return "Invalid password";
		}
		return null;
	}

	return "Unknown auth mode";
}

/**
 * Extract bearer token from Authorization header or query parameter.
 */
export function extractCredential(req: Request): string | undefined {
	// Check Authorization header (Bearer token)
	const authHeader = req.headers.authorization;
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.slice(7).trim();
	}

	// Check X-Auth-Token header
	const tokenHeader = req.headers["x-auth-token"];
	if (typeof tokenHeader === "string" && tokenHeader.trim()) {
		return tokenHeader.trim();
	}

	// Check query parameter
	const queryToken = req.query.token;
	if (typeof queryToken === "string" && queryToken.trim()) {
		return queryToken.trim();
	}

	return undefined;
}

/**
 * Express middleware for gateway auth.
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions) {
	const { auth, rateLimiter, trustedProxies } = options;

	return (req: Request, res: Response, next: NextFunction): void => {
		if (auth.mode === "none") {
			next();
			return;
		}

		const clientIp = resolveClientIp(req, trustedProxies);

		// Check rate limit
		if (rateLimiter && !rateLimiter.check(clientIp)) {
			res.status(429).json({ error: "Too many authentication attempts. Try again later." });
			return;
		}

		const credential = extractCredential(req);
		const error = authorizeGatewayRequest(auth, credential);

		if (error) {
			rateLimiter?.record(clientIp);
			res.status(401).json({ error });
			return;
		}

		next();
	};
}
