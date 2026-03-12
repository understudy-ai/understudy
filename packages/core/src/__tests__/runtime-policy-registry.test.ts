import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RUNTIME_POLICY_MODULE_ORDER } from "../runtime/policies/index.js";
import {
	createDefaultRuntimePolicyRegistry,
	RuntimePolicyRegistry,
} from "../runtime/policy-registry.js";

function makeContext() {
	return {
		runtimeProfile: "assistant" as const,
		modelLabel: "google/gemini-3-flash-preview",
		cwd: "/tmp/understudy",
		config: {} as any,
	};
}

describe("RuntimePolicyRegistry", () => {
	it("loads default runtime policy modules in deterministic order", async () => {
		const registry = createDefaultRuntimePolicyRegistry();
		const built = await registry.build({
			context: makeContext(),
		});

		expect(built.modules).toEqual([...DEFAULT_RUNTIME_POLICY_MODULE_ORDER]);
		expect(built.policies.length).toBeGreaterThan(0);
	});

	it("returns empty policy list when runtime policies are disabled", async () => {
		const registry = createDefaultRuntimePolicyRegistry();
		const built = await registry.build({
			context: makeContext(),
			config: {
				enabled: false,
			},
		});

		expect(built.modules).toEqual([]);
		expect(built.policies).toEqual([]);
	});

	it("supports module-level enable/disable flags", async () => {
		const registry = createDefaultRuntimePolicyRegistry();
		const built = await registry.build({
			context: makeContext(),
			config: {
				enabled: true,
				modules: [
					{ name: "sanitize_tool_params", enabled: true },
					{ name: "normalize_tool_result", enabled: false },
					{ name: "strip_assistant_directive_tags", enabled: true },
					{ name: "guard_assistant_reply", enabled: true },
				],
			},
		});

		expect(built.modules).toEqual([
			"sanitize_tool_params",
			"strip_assistant_directive_tags",
			"guard_assistant_reply",
		]);
		expect(built.policies.map((policy) => policy.name)).toEqual([
			"sanitize_tool_params",
			"strip_assistant_directive_tags",
			"guard_assistant_reply",
		]);
	});

	it("notifies for missing modules and continues with available modules", async () => {
		const onModuleMissing = vi.fn();
		const registry = createDefaultRuntimePolicyRegistry({
			onModuleMissing,
		});
		const built = await registry.build({
			context: makeContext(),
			config: {
				modules: [
					{ name: "nonexistent_module", enabled: true },
					{ name: "sanitize_tool_params", enabled: true },
				],
			},
		});

		expect(onModuleMissing).toHaveBeenCalledWith("nonexistent_module");
		expect(built.modules).toEqual(["sanitize_tool_params"]);
		expect(built.policies.map((policy) => policy.name)).toEqual(["sanitize_tool_params"]);
	});

	it("allows custom module registration", async () => {
		const registry = new RuntimePolicyRegistry();
		registry.register("custom_policy", () => ({
			name: "custom_policy",
		}));

		const built = await registry.build({
			context: makeContext(),
			config: {
				modules: [{ name: "custom_policy", enabled: true }],
			},
		});

		expect(built.modules).toEqual(["custom_policy"]);
		expect(built.policies.map((policy) => policy.name)).toEqual(["custom_policy"]);
	});
});
