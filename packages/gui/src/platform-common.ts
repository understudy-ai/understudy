import type {
	GuiEnvironmentReadinessCheck,
	GuiEnvironmentReadinessSnapshot,
} from "./readiness.js";

export const GUI_UNSUPPORTED_MESSAGE = "GUI tools are not supported on this platform.";

export function resolveSnapshotStatus(
	checks: GuiEnvironmentReadinessCheck[],
): GuiEnvironmentReadinessSnapshot["status"] {
	if (checks.every((check) => check.status === "unsupported")) {
		return "unsupported";
	}
	if (checks.some((check) => check.status === "error")) {
		return "blocked";
	}
	if (checks.some((check) => check.status === "warn")) {
		return "degraded";
	}
	return "ready";
}
