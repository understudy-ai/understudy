import { describe, expect, it, vi } from "vitest";
import { resolveRuntimeModelCandidates } from "../runtime/bridge/model-resolution-bridge.js";

describe("resolveRuntimeModelCandidates", () => {
	it("uses explicit model when provided", () => {
		const explicitModel = { provider: "anthropic", id: "claude-sonnet-4" } as any;
		const result = resolveRuntimeModelCandidates({
			explicitModel,
			defaultProvider: "anthropic",
			defaultModel: "claude-opus-4",
			modelFallbacks: ["google/gemini-2.5-pro"],
		});

		expect(result.candidates).toEqual([
			expect.objectContaining({
				source: "explicit",
				model: explicitModel,
				modelLabel: "anthropic/claude-sonnet-4",
			}),
		]);
		expect(result.modelLabelFallback).toBe("anthropic/claude-sonnet-4");
		expect(result.attempts).toEqual([]);
	});

	it("returns the primary model first when it resolves", () => {
		const resolver = vi.fn((provider: string, modelId: string) => {
			return { provider, id: modelId } as any;
		});

		const result = resolveRuntimeModelCandidates({
			defaultProvider: "anthropic",
			defaultModel: "claude-opus-4",
			modelFallbacks: ["google/gemini-2.5-pro"],
			resolveModel: resolver,
		});

		expect(result.candidates[0]).toEqual(
			expect.objectContaining({
				source: "default",
				modelLabel: "anthropic/claude-opus-4",
			}),
		);
		expect(result.modelLabelFallback).toBe("anthropic/claude-opus-4");
		expect(result.candidates[0]?.model).toBeTruthy();
		expect(result.attempts).toHaveLength(2);
		expect(result.attempts[0].status).toBe("resolved");
	});

	it("returns fallback candidates and records failed attempts", () => {
		const resolver = vi.fn((provider: string, modelId: string) => {
			if (provider === "google" && modelId === "gemini-2.5-pro") {
				return { provider, id: modelId } as any;
			}
			throw new Error(`missing:${provider}/${modelId}`);
		});

		const result = resolveRuntimeModelCandidates({
			defaultProvider: "anthropic",
			defaultModel: "claude-opus-4",
			modelFallbacks: ["invalid", "google/gemini-2.5-pro"],
			resolveModel: resolver,
		});

		expect(result.candidates).toEqual([
			expect.objectContaining({
				modelLabel: "google/gemini-2.5-pro",
				source: "fallback_chain",
			}),
		]);
		expect(result.candidates[0]?.model).toBeTruthy();
		expect(result.attempts).toEqual([
			{
				modelRef: "anthropic/claude-opus-4",
				status: "unavailable",
				provider: "anthropic",
				modelId: "claude-opus-4",
				error: "missing:anthropic/claude-opus-4",
			},
			{
				modelRef: "invalid",
				status: "invalid_ref",
				error: "invalid provider/model reference",
			},
			{
				modelRef: "google/gemini-2.5-pro",
				status: "resolved",
				provider: "google",
				modelId: "gemini-2.5-pro",
			},
		]);
	});

	it("returns the default label fallback when the chain cannot resolve", () => {
		const result = resolveRuntimeModelCandidates({
			defaultProvider: "anthropic",
			defaultModel: "claude-opus-4",
			modelFallbacks: ["bad-ref"],
			resolveModel: () => {
				throw new Error("unavailable");
			},
		});

		expect(result.candidates).toEqual([]);
		expect(result.modelLabelFallback).toBe("anthropic/claude-opus-4");
		expect(result.attempts).toHaveLength(2);
	});

	it("returns all resolvable candidates in fallback order", () => {
		const resolver = vi.fn((provider: string, modelId: string) => {
			if (provider === "anthropic" && modelId === "claude-opus-4") {
				return { provider, id: modelId } as any;
			}
			if (provider === "google" && modelId === "gemini-2.5-pro") {
				return { provider, id: modelId } as any;
			}
			throw new Error(`missing:${provider}/${modelId}`);
		});

		const result = resolveRuntimeModelCandidates({
			defaultProvider: "anthropic",
			defaultModel: "claude-opus-4",
			modelFallbacks: ["google/gemini-2.5-pro", "bad-ref"],
			resolveModel: resolver,
		});

		expect(result.modelLabelFallback).toBe("anthropic/claude-opus-4");
		expect(result.candidates.map((candidate) => candidate.modelLabel)).toEqual([
			"anthropic/claude-opus-4",
			"google/gemini-2.5-pro",
		]);
		expect(result.attempts).toEqual([
			{
				modelRef: "anthropic/claude-opus-4",
				status: "resolved",
				provider: "anthropic",
				modelId: "claude-opus-4",
			},
			{
				modelRef: "google/gemini-2.5-pro",
				status: "resolved",
				provider: "google",
				modelId: "gemini-2.5-pro",
			},
			{
				modelRef: "bad-ref",
				status: "invalid_ref",
				error: "invalid provider/model reference",
			},
		]);
	});
});
