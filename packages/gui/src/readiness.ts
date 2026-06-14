import { resolveGuiPlatformBackend } from "./platform.js";

export interface GuiReadinessDeps {
	now?: () => number;
	runSwiftBooleanCheck?: (script: string) => Promise<boolean>;
	resolveNativeHelperBinary?: () => Promise<string>;
	accessPath?: (path: string) => Promise<void>;
}

export interface GuiEnvironmentReadinessCheck {
	id: string;
	label: string;
	status: "ok" | "warn" | "error" | "unsupported";
	summary: string;
	detail?: string;
}

export interface GuiEnvironmentReadinessSnapshot {
	status: "ready" | "degraded" | "blocked" | "unsupported";
	checkedAt: number;
	checks: GuiEnvironmentReadinessCheck[];
}

export async function inspectGuiEnvironmentReadiness(
	platform: NodeJS.Platform = process.platform,
	deps: GuiReadinessDeps = {},
): Promise<GuiEnvironmentReadinessSnapshot> {
	return await resolveGuiPlatformBackend(platform).inspectReadiness(platform, deps);
}
