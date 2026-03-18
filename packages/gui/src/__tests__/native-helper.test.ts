import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	access: vi.fn(),
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	execFileAsync: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
	const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
	return {
		...actual,
		access: mocks.access,
		mkdir: mocks.mkdir,
		writeFile: mocks.writeFile,
	};
});

vi.mock("../exec-utils.js", () => ({
	execFileAsync: mocks.execFileAsync,
}));

describe("resolveNativeGuiHelperBinary", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mocks.access.mockRejectedValue(new Error("missing helper"));
		mocks.mkdir.mockResolvedValue(undefined);
		mocks.writeFile.mockResolvedValue(undefined);
	});

	afterEach(() => {
		delete process.env.UNDERSTUDY_GUI_NATIVE_HELPER_PATH;
	});

	it("shares one in-flight compile across concurrent callers and caches the result", async () => {
		let compileCalls = 0;
		mocks.execFileAsync.mockImplementation(async () => {
			compileCalls += 1;
			await new Promise((resolve) => setTimeout(resolve, 10));
			return { stdout: "", stderr: "" };
		});

		const { resolveNativeGuiHelperBinary } = await import("../native-helper.js");
		const [first, second, third] = await Promise.all([
			resolveNativeGuiHelperBinary(),
			resolveNativeGuiHelperBinary(),
			resolveNativeGuiHelperBinary(),
		]);
		const cached = await resolveNativeGuiHelperBinary();

		expect(compileCalls).toBe(1);
		expect(first).toBe(second);
		expect(second).toBe(third);
		expect(third).toBe(cached);
	});

	it("clears the shared promise after compile failures so later calls can retry", async () => {
		mocks.execFileAsync
			.mockRejectedValueOnce(new Error("swiftc failed"))
			.mockResolvedValueOnce({ stdout: "", stderr: "" });

		const { resolveNativeGuiHelperBinary } = await import("../native-helper.js");

		await expect(resolveNativeGuiHelperBinary()).rejects.toThrow("swiftc failed");
		await expect(resolveNativeGuiHelperBinary()).resolves.toContain("understudy-gui-native-helper");
		expect(mocks.execFileAsync).toHaveBeenCalledTimes(2);
	});
});
