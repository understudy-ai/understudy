import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	openExternalPath: vi.fn(),
	resolveGatewayBrowserToken: vi.fn(),
}));

vi.mock("./open-path.js", () => ({
	openExternalPath: mocks.openExternalPath,
}));

vi.mock("./gateway-browser-auth.js", () => ({
	resolveGatewayBrowserToken: mocks.resolveGatewayBrowserToken,
}));

import { runWebChatCommand } from "./webchat.js";

describe("runWebChatCommand", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.openExternalPath.mockResolvedValue({
			ok: true,
			command: "open",
			args: [],
		});
		mocks.resolveGatewayBrowserToken.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("opens webchat by default", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runWebChatCommand({ port: "19999", host: "localhost" });

		expect(mocks.resolveGatewayBrowserToken).toHaveBeenCalledWith(undefined);
		expect(mocks.openExternalPath).toHaveBeenCalledWith("http://localhost:19999/webchat");
		expect(log).toHaveBeenCalledWith("Opening http://localhost:19999/webchat ...");
	});

	it("forwards token query parameters", async () => {
		mocks.resolveGatewayBrowserToken.mockResolvedValue("secret-token");
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		await runWebChatCommand({ port: "19999", host: "localhost", config: "/tmp/understudy.json5" });

		expect(mocks.openExternalPath).toHaveBeenCalledWith(
			"http://localhost:19999/webchat?token=secret-token",
		);
		expect(mocks.resolveGatewayBrowserToken).toHaveBeenCalledWith("/tmp/understudy.json5");
		expect(log).toHaveBeenCalledWith(
			"Opening http://localhost:19999/webchat?token=secret-token ...",
		);
	});
});
