export type RuntimePlatformCapabilitySource = "core" | "plugin";

export interface RuntimePlatformCapability {
	id: string;
	label: string;
	description: string;
	source?: RuntimePlatformCapabilitySource;
	tags?: string[];
	metadata?: Record<string, unknown>;
}

function uniqueStrings(values: string[] | undefined): string[] | undefined {
	if (!Array.isArray(values) || values.length === 0) {
		return undefined;
	}
	const normalized = values
		.map((value) => value.trim())
		.filter(Boolean);
	if (normalized.length === 0) {
		return undefined;
	}
	return Array.from(new Set(normalized)).sort((left, right) => left.localeCompare(right));
}

function sourcePriority(source: RuntimePlatformCapabilitySource | undefined): number {
	return source === "plugin" ? 1 : 2;
}

function shouldPreferIncomingCapability(
	existing: RuntimePlatformCapability | undefined,
	source: RuntimePlatformCapabilitySource,
): boolean {
	if (!existing) {
		return true;
	}
	const existingSource = existing.source ?? "core";
	if (existingSource === source) {
		return true;
	}
	return sourcePriority(source) >= sourcePriority(existingSource);
}

function mergeCapabilityMetadata(
	existing: RuntimePlatformCapability | undefined,
	metadata: Record<string, unknown> | undefined,
	preferIncoming: boolean,
): Record<string, unknown> | undefined {
	if (!existing?.metadata && !metadata) {
		return undefined;
	}
	const mergedMetadata = preferIncoming
		? {
			...(existing?.metadata ?? {}),
			...(metadata ?? {}),
		}
		: {
			...(metadata ?? {}),
			...(existing?.metadata ?? {}),
		};
	return Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined;
}

export function normalizeRuntimePlatformCapabilities(
	capabilities: RuntimePlatformCapability[] | undefined,
): RuntimePlatformCapability[] {
	if (!Array.isArray(capabilities) || capabilities.length === 0) {
		return [];
	}
	const merged = new Map<string, RuntimePlatformCapability>();
	for (const capability of capabilities) {
		if (!capability || typeof capability !== "object") {
			continue;
		}
		const id = capability.id?.trim().toLowerCase();
		if (!id) {
			continue;
		}
		const label = capability.label?.trim() || id;
		const description = capability.description?.trim() || `Platform capability: ${label}`;
		const source = capability.source === "plugin" ? "plugin" : "core";
		const existing = merged.get(id);
		const preferIncoming = shouldPreferIncomingCapability(existing, source);
		merged.set(id, {
			id,
			label: preferIncoming ? label : (existing?.label ?? label),
			description: preferIncoming ? description : (existing?.description ?? description),
			source: preferIncoming ? source : (existing?.source ?? source),
			tags: uniqueStrings([
				...(existing?.tags ?? []),
				...(Array.isArray(capability.tags) ? capability.tags : []),
			]),
			metadata: mergeCapabilityMetadata(existing, capability.metadata, preferIncoming),
		});
	}
	return Array.from(merged.values()).sort((left, right) => {
		const leftSource = left.source ?? "core";
		const rightSource = right.source ?? "core";
		if (leftSource !== rightSource) {
			return leftSource.localeCompare(rightSource);
		}
		return left.id.localeCompare(right.id);
	});
}

export function formatRuntimePlatformCapabilities(
	capabilities: RuntimePlatformCapability[] | undefined,
): string {
	const normalized = normalizeRuntimePlatformCapabilities(capabilities);
	if (normalized.length === 0) {
		return "No platform capabilities are currently registered.";
	}
	return normalized.map((capability) => {
		const header = `${capability.label} [${capability.id}]`;
		const tags = capability.tags?.length ? `Tags: ${capability.tags.join(", ")}` : undefined;
		const source = `Source: ${capability.source ?? "core"}`;
		return [header, capability.description, source, tags].filter(Boolean).join("\n");
	}).join("\n\n");
}
