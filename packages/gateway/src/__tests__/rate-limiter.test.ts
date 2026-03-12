import { describe, it, expect, afterEach } from "vitest";
import { AuthRateLimiter } from "../rate-limiter.js";

describe("AuthRateLimiter", () => {
	let limiter: AuthRateLimiter;

	afterEach(() => {
		limiter?.dispose();
	});

	it("allows requests under the limit", () => {
		limiter = new AuthRateLimiter({ maxAttempts: 3, windowMs: 60000, lockoutMs: 60000 });
		expect(limiter.check("1.2.3.4")).toBe(true);
		limiter.record("1.2.3.4");
		limiter.record("1.2.3.4");
		expect(limiter.check("1.2.3.4")).toBe(true);
	});

	it("locks out after max attempts", () => {
		limiter = new AuthRateLimiter({ maxAttempts: 2, windowMs: 60000, lockoutMs: 60000 });
		limiter.record("1.2.3.4");
		limiter.record("1.2.3.4");
		expect(limiter.check("1.2.3.4")).toBe(false);
	});

	it("exempts loopback by default", () => {
		limiter = new AuthRateLimiter({ maxAttempts: 1, windowMs: 60000, lockoutMs: 60000 });
		limiter.record("127.0.0.1");
		expect(limiter.check("127.0.0.1")).toBe(true);
	});

	it("does not exempt loopback when configured", () => {
		limiter = new AuthRateLimiter({ maxAttempts: 1, windowMs: 60000, lockoutMs: 60000, exemptLoopback: false });
		limiter.record("127.0.0.1");
		expect(limiter.check("127.0.0.1")).toBe(false);
	});

	it("tracks different IPs independently", () => {
		limiter = new AuthRateLimiter({ maxAttempts: 1, windowMs: 60000, lockoutMs: 60000, exemptLoopback: false });
		limiter.record("1.1.1.1");
		expect(limiter.check("1.1.1.1")).toBe(false);
		expect(limiter.check("2.2.2.2")).toBe(true);
	});
});
