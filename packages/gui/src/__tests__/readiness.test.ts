import { describe, expect, it, vi } from "vitest";
import { inspectGuiEnvironmentReadiness } from "../readiness.js";

describe("inspectGuiEnvironmentReadiness", () => {
	it("reports unsupported on non-macOS platforms", async () => {
		const snapshot = await inspectGuiEnvironmentReadiness("linux");

		expect(snapshot).toEqual({
			status: "unsupported",
			checkedAt: expect.any(Number),
			checks: [
				{
					id: "platform",
					label: "Platform",
					status: "unsupported",
					summary: "GUI runtime checks are currently implemented for macOS only.",
					detail: "Current platform: linux",
				},
			],
		});
	});

	it("reports native helper readiness on macOS when permissions and helper are available", async () => {
		const runSwiftBooleanCheck = vi.fn(async () => true);
		const snapshot = await inspectGuiEnvironmentReadiness("darwin", {
			now: () => 123,
			runSwiftBooleanCheck,
			resolveNativeHelperBinary: async () => "/tmp/understudy-native-helper",
			accessPath: async () => {},
		});

		expect(snapshot).toMatchObject({
			status: "ready",
			checkedAt: 123,
		});
		expect(snapshot.checks.find((check) => check.id === "native_helper")).toMatchObject({
			status: "ok",
			summary: "Native GUI helper is ready for capture and input execution.",
			detail: "/tmp/understudy-native-helper",
		});
		expect(runSwiftBooleanCheck).toHaveBeenCalledTimes(2);
	});

	it("reports degraded when permission probes cannot be confirmed but the helper is available", async () => {
		const snapshot = await inspectGuiEnvironmentReadiness("darwin", {
			runSwiftBooleanCheck: vi.fn(async () => {
				throw new Error("swift unavailable");
			}),
			resolveNativeHelperBinary: async () => "/tmp/understudy-native-helper",
			accessPath: async () => {},
		});

		expect(snapshot.status).toBe("degraded");
		expect(snapshot.checks.find((check) => check.id === "accessibility")).toMatchObject({
			status: "warn",
			summary: "Could not confirm Accessibility permission state.",
			detail: expect.stringContaining("swift unavailable"),
		});
		expect(snapshot.checks.find((check) => check.id === "screen_recording")).toMatchObject({
			status: "warn",
			summary: "Could not confirm Screen Recording permission state.",
			detail: expect.stringContaining("swift unavailable"),
		});
		expect(snapshot.checks.find((check) => check.id === "native_helper")).toMatchObject({
			status: "ok",
			detail: "/tmp/understudy-native-helper",
		});
	});

	it("blocks macOS readiness when the native helper cannot be resolved", async () => {
		const snapshot = await inspectGuiEnvironmentReadiness("darwin", {
			runSwiftBooleanCheck: async () => true,
			resolveNativeHelperBinary: async () => {
				throw new Error("swiftc missing");
			},
		});

		expect(snapshot.status).toBe("blocked");
		expect(snapshot.checks.find((check) => check.id === "native_helper")).toMatchObject({
			status: "error",
			summary: "Native GUI helper is unavailable.",
			detail: expect.stringContaining("swiftc missing"),
		});
	});
});
