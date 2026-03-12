/**
 * Lightweight value-extraction helpers for untyped JSON payloads.
 *
 * These return `undefined` when the value is not of the expected type —
 * callers can therefore distinguish "missing" from "present but wrong type".
 */

export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

export function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Extract a finite number from an unknown value.
 *
 * Accepts both `number` and numeric `string` inputs (the latter is common in
 * LLM-produced JSON where numbers are occasionally quoted).
 */
export function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim().length > 0) {
		const parsed = Number.parseFloat(value.trim());
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

export function asStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const normalized = value
		.map((entry) => (typeof entry === "string" ? entry.trim() : ""))
		.filter(Boolean);
	return normalized.length > 0 ? normalized : undefined;
}
