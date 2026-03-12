import {
	asBoolean as asCanonicalBoolean,
	asNumber as asCanonicalNumber,
	asRecord as asCanonicalRecord,
	asString,
} from "@understudy/core";

export { asString };

export function asRecord(value: unknown): Record<string, unknown> {
	return asCanonicalRecord(value) ?? {};
}

/**
 * Coerce a value to an integer. Unlike `@understudy/core`'s `asNumber` which
 * returns the raw parsed float, this variant intentionally floors the result
 * so that gateway RPC params (e.g. pagination offsets, limits) are always
 * whole numbers.
 */
export function asNumber(value: unknown): number | undefined {
	const parsed = asCanonicalNumber(value);
	return parsed !== undefined ? Math.floor(parsed) : undefined;
}

export function normalizeComparableText(value: string): string {
	return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function asBoolean(value: unknown): boolean | undefined {
	const parsed = asCanonicalBoolean(value);
	if (parsed !== undefined) return parsed;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "true") return true;
		if (normalized === "false") return false;
	}
	return undefined;
}

export function sanitizePathSegment(value: string | undefined, fallback: string): string {
	const normalized = value?.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	return normalized || fallback;
}
