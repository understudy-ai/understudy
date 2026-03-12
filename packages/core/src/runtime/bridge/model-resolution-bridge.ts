import { getModel, type Model } from "@mariozechner/pi-ai";

export interface RuntimeModelResolutionAttempt {
	modelRef: string;
	status: "resolved" | "invalid_ref" | "unavailable";
	provider?: string;
	modelId?: string;
	error?: string;
}

export interface RuntimeResolvedModelCandidate {
	model: Model<any>;
	modelLabel: string;
	provider: string;
	modelId: string;
	source: "explicit" | "default" | "fallback_chain";
}

export interface RuntimeModelCandidatesResult {
	candidates: RuntimeResolvedModelCandidate[];
	attempts: RuntimeModelResolutionAttempt[];
	modelLabelFallback: string;
}

export interface RuntimeModelResolutionOptions {
	explicitModel?: Model<any>;
	defaultProvider: string;
	defaultModel: string;
	modelFallbacks?: string[];
	resolveModel?: (provider: string, modelId: string) => Model<any>;
}

function parseModelRef(modelRef: string): { provider: string; modelId: string } | undefined {
	const raw = modelRef.trim();
	if (!raw) return undefined;
	const slashIndex = raw.indexOf("/");
	if (slashIndex <= 0 || slashIndex >= raw.length - 1) {
		return undefined;
	}
	return {
		provider: raw.slice(0, slashIndex),
		modelId: raw.slice(slashIndex + 1),
	};
}

function resolveModelChain(options: RuntimeModelResolutionOptions): string[] {
	return [
		`${options.defaultProvider}/${options.defaultModel}`,
		...(options.modelFallbacks ?? []),
	]
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function resolveRuntimeModelCandidates(
	options: RuntimeModelResolutionOptions,
): RuntimeModelCandidatesResult {
	if (options.explicitModel) {
		return {
			candidates: [
				{
					model: options.explicitModel,
					modelLabel: `${options.explicitModel.provider}/${options.explicitModel.id}`,
					provider: options.explicitModel.provider,
					modelId: options.explicitModel.id,
					source: "explicit",
				},
			],
			attempts: [],
			modelLabelFallback: `${options.explicitModel.provider}/${options.explicitModel.id}`,
		};
	}

	const attempts: RuntimeModelResolutionAttempt[] = [];
	const candidates: RuntimeResolvedModelCandidate[] = [];
	const seen = new Set<string>();
	const resolveModelFn = options.resolveModel ?? ((provider: string, modelId: string) => getModel(provider as any, modelId as any));
	const fallbackChain = resolveModelChain(options);

	for (let i = 0; i < fallbackChain.length; i += 1) {
		const modelRef = fallbackChain[i];
		const parsed = parseModelRef(modelRef);
		if (!parsed) {
			attempts.push({
				modelRef,
				status: "invalid_ref",
				error: "invalid provider/model reference",
			});
			continue;
		}

		try {
			const model = resolveModelFn(parsed.provider, parsed.modelId);
			attempts.push({
				modelRef,
				status: "resolved",
				provider: parsed.provider,
				modelId: parsed.modelId,
			});
			const modelLabel = `${parsed.provider}/${parsed.modelId}`;
			if (seen.has(modelLabel)) {
				continue;
			}
			seen.add(modelLabel);
			candidates.push({
				model,
				modelLabel,
				provider: parsed.provider,
				modelId: parsed.modelId,
				source: i === 0 ? "default" : "fallback_chain",
			});
		} catch (error) {
			attempts.push({
				modelRef,
				status: "unavailable",
				provider: parsed.provider,
				modelId: parsed.modelId,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	return {
		candidates,
		attempts,
		modelLabelFallback: `${options.defaultProvider}/${options.defaultModel}`,
	};
}
