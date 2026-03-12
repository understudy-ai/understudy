import { describe, it, expect } from "vitest";
import { safeEqualSecret, authorizeGatewayRequest, resolveGatewayAuth } from "../auth.js";

describe("safeEqualSecret", () => {
	it("returns true for matching strings", () => {
		expect(safeEqualSecret("abc123", "abc123")).toBe(true);
	});

	it("returns false for non-matching strings", () => {
		expect(safeEqualSecret("abc123", "xyz789")).toBe(false);
	});

	it("returns false for different lengths", () => {
		expect(safeEqualSecret("short", "longer-string")).toBe(false);
	});

	it("returns false for empty vs non-empty", () => {
		expect(safeEqualSecret("", "notempty")).toBe(false);
	});

	it("returns true for empty vs empty", () => {
		expect(safeEqualSecret("", "")).toBe(true);
	});
});

describe("authorizeGatewayRequest", () => {
	it('allows all requests in "none" mode', () => {
		expect(authorizeGatewayRequest({ mode: "none" })).toBeNull();
		expect(authorizeGatewayRequest({ mode: "none" }, "anything")).toBeNull();
	});

	it('requires token in "token" mode', () => {
		const auth = { mode: "token" as const, token: "secret-token" };
		expect(authorizeGatewayRequest(auth)).toBe("Authentication required");
		expect(authorizeGatewayRequest(auth, "wrong")).toBe("Invalid token");
		expect(authorizeGatewayRequest(auth, "secret-token")).toBeNull();
	});

	it('requires password in "password" mode', () => {
		const auth = { mode: "password" as const, password: "secret-pass" };
		expect(authorizeGatewayRequest(auth)).toBe("Authentication required");
		expect(authorizeGatewayRequest(auth, "wrong")).toBe("Invalid password");
		expect(authorizeGatewayRequest(auth, "secret-pass")).toBeNull();
	});

	it("returns error when server secret not configured", () => {
		expect(authorizeGatewayRequest({ mode: "token" }, "any")).toBe("Server auth token not configured");
		expect(authorizeGatewayRequest({ mode: "password" }, "any")).toBe("Server auth password not configured");
	});
});

describe("resolveGatewayAuth", () => {
	it("defaults to none mode", () => {
		const result = resolveGatewayAuth();
		expect(result.mode).toBe("none");
	});

	it("uses config values when no env vars", () => {
		const result = resolveGatewayAuth({ mode: "token", token: "cfg-token" });
		expect(result.mode).toBe("token");
		expect(result.token).toBe("cfg-token");
	});
});
