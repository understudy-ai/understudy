/**
 * Security headers middleware for gateway HTTP responses.
 */

import type { Request, Response, NextFunction } from "express";

/**
 * Apply standard security headers to all responses.
 */
export function securityHeaders() {
	return (_req: Request, res: Response, next: NextFunction): void => {
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("X-Frame-Options", "DENY");
		res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
		res.setHeader(
			"Content-Security-Policy",
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data:;",
		);
		res.setHeader("X-XSS-Protection", "0");
		next();
	};
}
