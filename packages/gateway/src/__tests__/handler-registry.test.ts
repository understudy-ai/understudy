import { describe, it, expect } from "vitest";
import { HandlerRegistry } from "../handler-registry.js";

describe("HandlerRegistry", () => {
	it("registers and dispatches handlers", async () => {
		const registry = new HandlerRegistry();
		registry.register("test.method", async (req) => ({
			id: req.id,
			result: { echo: req.params.text },
		}));

		expect(registry.has("test.method")).toBe(true);
		expect(registry.size).toBe(1);

		const response = await registry.dispatch(
			{ id: "1", method: "test.method" as any, params: { text: "hello" } },
			{} as any,
		);
		expect(response.result).toEqual({ echo: "hello" });
	});

	it("returns 404 for unknown methods", async () => {
		const registry = new HandlerRegistry();
		const response = await registry.dispatch(
			{ id: "1", method: "unknown" as any, params: {} },
			{} as any,
		);
		expect(response.error?.code).toBe(404);
	});

	it("lists registered methods", () => {
		const registry = new HandlerRegistry();
		registry.register("a.method", async (req) => ({ id: req.id, result: {} }));
		registry.register("b.method", async (req) => ({ id: req.id, result: {} }));
		expect(registry.listMethods()).toEqual(["a.method", "b.method"]);
	});

	it("gets handler by method name", () => {
		const registry = new HandlerRegistry();
		const handler = async (req: any) => ({ id: req.id, result: {} });
		registry.register("test", handler);
		expect(registry.get("test")).toBe(handler);
		expect(registry.get("missing")).toBeUndefined();
	});
});
