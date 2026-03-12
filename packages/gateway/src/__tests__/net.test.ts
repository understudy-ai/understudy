import { describe, it, expect } from "vitest";
import { normalizeIp, isLoopbackAddress } from "../net.js";

describe("normalizeIp", () => {
	it("strips IPv4-mapped IPv6 prefix", () => {
		expect(normalizeIp("::ffff:192.168.1.1")).toBe("192.168.1.1");
	});

	it("lowercases IPv6", () => {
		expect(normalizeIp("::FFFF:10.0.0.1")).toBe("10.0.0.1");
	});

	it("trims whitespace", () => {
		expect(normalizeIp("  127.0.0.1  ")).toBe("127.0.0.1");
	});

	it("leaves normal IPv4 unchanged", () => {
		expect(normalizeIp("10.0.0.1")).toBe("10.0.0.1");
	});
});

describe("isLoopbackAddress", () => {
	it("detects 127.0.0.1", () => {
		expect(isLoopbackAddress("127.0.0.1")).toBe(true);
	});

	it("detects ::1", () => {
		expect(isLoopbackAddress("::1")).toBe(true);
	});

	it("detects ::ffff:127.0.0.1", () => {
		expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
	});

	it("detects 127.x.x.x range", () => {
		expect(isLoopbackAddress("127.0.0.2")).toBe(true);
		expect(isLoopbackAddress("127.255.255.255")).toBe(true);
	});

	it("rejects non-loopback", () => {
		expect(isLoopbackAddress("192.168.1.1")).toBe(false);
		expect(isLoopbackAddress("10.0.0.1")).toBe(false);
	});
});
