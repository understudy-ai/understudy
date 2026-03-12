import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	buildWorkspaceSkillSnapshot: vi.fn(),
	listRuntimeToolCatalog: vi.fn(),
	listGuiToolCatalog: vi.fn(),
}));

vi.mock("@understudy/core", async () => {
	const actual = await vi.importActual<any>("@understudy/core");
	return {
		...actual,
		buildWorkspaceSkillSnapshot: mocks.buildWorkspaceSkillSnapshot,
	};
});

vi.mock("../runtime-toolset.js", async () => {
	const actual = await vi.importActual<any>("../runtime-toolset.js");
	return {
		...actual,
		listRuntimeToolCatalog: mocks.listRuntimeToolCatalog,
	};
});

vi.mock("../gui-tools.js", async () => {
	const actual = await vi.importActual<any>("../gui-tools.js");
	return {
		...actual,
		listGuiToolCatalog: mocks.listGuiToolCatalog,
	};
});

import { buildTeachCapabilitySnapshot } from "../teach-capability-snapshot.js";

afterEach(() => {
	vi.clearAllMocks();
});

describe("buildTeachCapabilitySnapshot", () => {
	it("keeps runtime and gui tools available when workspace skill snapshot building fails", () => {
		mocks.listRuntimeToolCatalog.mockReturnValue({
			tools: [
				{
					name: "web_fetch",
					label: "Web Fetch",
					description: "Fetch a webpage.",
					category: "web",
					surface: "runtime",
				},
				{
					name: "bash",
					label: "Bash",
					description: "Run shell commands.",
					category: "workspace",
					surface: "runtime",
				},
			],
			summary: {
				total: 2,
				byCategory: [],
				bySurface: [],
			},
		});
		mocks.listGuiToolCatalog.mockReturnValue([
			{
				name: "gui_click",
				label: "GUI Click",
				description: "Click a visible target.",
			},
		]);
		mocks.buildWorkspaceSkillSnapshot.mockImplementation(() => {
			throw new Error("skill snapshot failed");
		});

		const snapshot = buildTeachCapabilitySnapshot({
			workspaceDir: "/tmp/workspace",
		});

		expect(snapshot.tools).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "bash",
				executionRoute: "shell",
			}),
			expect.objectContaining({
				name: "web_fetch",
				executionRoute: "browser",
			}),
			expect.objectContaining({
				name: "gui_click",
				executionRoute: "gui",
			}),
		]));
		expect(snapshot.skills).toEqual([]);
		expect(mocks.buildWorkspaceSkillSnapshot).toHaveBeenCalledWith({
			workspaceDir: "/tmp/workspace",
			config: undefined,
		});
	});
});
