import type { GuiGroundingProvider } from "@understudy/gui";
import {
	createResponsesApiGroundingProvider,
	type ResponsesApiGroundingProviderOptions,
} from "./response-grounding-provider.js";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1/responses";
const DEFAULT_OPENAI_MODEL = "gpt-5.4";

export interface OpenAIGroundingProviderOptions extends Omit<ResponsesApiGroundingProviderOptions, "baseUrl" | "model" | "providerName"> {
	baseUrl?: string;
	model?: string;
	providerName?: string;
}

export function createOpenAIGroundingProvider(
	options: OpenAIGroundingProviderOptions = {},
): GuiGroundingProvider {
	const model = options.model?.trim() || DEFAULT_OPENAI_MODEL;
	return createResponsesApiGroundingProvider({
		...options,
		baseUrl: options.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL,
		model,
		providerName: options.providerName?.trim() || `openai:${model}`,
		inputImageDetail: options.inputImageDetail ?? "high",
	});
}
