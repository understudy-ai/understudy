import { randomBytes } from "node:crypto";
import { ConfigManager } from "@understudy/core";
import { DEFAULT_CONFIG, type UnderstudyConfig } from "@understudy/types";

function toNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export async function resolveGatewayBrowserToken(configPath?: string): Promise<string | undefined> {
	const envToken = toNonEmptyString(process.env.UNDERSTUDY_GATEWAY_TOKEN);
	if (envToken) {
		return envToken;
	}

	try {
		const config = await ConfigManager.load(configPath);
		return toNonEmptyString(config.get().gateway?.auth?.token);
	} catch {
		return undefined;
	}
}

export function ensureGatewayBrowserTokenInConfig(config: UnderstudyConfig): {
	token: string;
	source: "env" | "config" | "generated";
} {
	const envToken = toNonEmptyString(process.env.UNDERSTUDY_GATEWAY_TOKEN);
	if (envToken) {
		return { token: envToken, source: "env" };
	}

	const configuredToken = toNonEmptyString(config.gateway?.auth?.token);
	if (configuredToken) {
		return { token: configuredToken, source: "config" };
	}

	const generatedToken = randomBytes(24).toString("base64url");
	const currentGatewayConfig = config.gateway ?? DEFAULT_CONFIG.gateway!;
	config.gateway = {
		...currentGatewayConfig,
		auth: Object.assign({}, currentGatewayConfig.auth, {
			mode: currentGatewayConfig.auth?.mode ?? "none",
			token: generatedToken,
		}),
	};
	return { token: generatedToken, source: "generated" };
}
