import { describe, expect, it, vi } from "vitest";
import {
	applySystemPromptOverrideToSession,
} from "../runtime/system-prompt-override.js";

describe("system prompt override", () => {
	it("trims a string override and sets the system prompt", () => {
		const setSystemPrompt = vi.fn();
		const session: any = {
			agent: { setSystemPrompt },
		};

		applySystemPromptOverrideToSession(session, "  You are Understudy.  ");

		expect(setSystemPrompt).toHaveBeenCalledWith("You are Understudy.");
		expect(session._baseSystemPrompt).toBe("You are Understudy.");
		expect(session._rebuildSystemPrompt([])).toBe("You are Understudy.");
	});

	it("supports function overrides", () => {
		const setSystemPrompt = vi.fn();
		const override = vi.fn(() => "Custom policy prompt");
		const session: any = {
			agent: { setSystemPrompt },
		};

		applySystemPromptOverrideToSession(session, override);

		expect(override).toHaveBeenCalledOnce();
		expect(setSystemPrompt).toHaveBeenCalledWith("Custom policy prompt");
		expect(session._baseSystemPrompt).toBe("Custom policy prompt");
		expect(session._rebuildSystemPrompt(["read", "bash"])).toBe("Custom policy prompt");
	});
});
