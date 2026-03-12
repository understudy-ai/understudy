import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type StoredCredential = {
	type?: "api_key" | "oauth";
	[key: string]: unknown;
};

type StoredCredentialMap = Record<string, StoredCredential>;

function readJsonRecord(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return undefined;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function normalizeStoredCredential(record: Record<string, unknown>): StoredCredential | undefined {
	const rawType = typeof record.type === "string"
		? record.type
		: undefined;
	const normalizedType = rawType === "oauth"
		? "oauth"
		: rawType === "api_key"
			? "api_key"
			: undefined;
	if (!normalizedType) {
		return undefined;
	}

	if (normalizedType === "oauth") {
		const access = typeof record.access === "string"
			? record.access
			: undefined;
		const refresh = typeof record.refresh === "string"
			? record.refresh
			: undefined;
		const expires = typeof record.expires === "number" && Number.isFinite(record.expires)
			? record.expires
			: undefined;
		if (!access || !refresh || expires === undefined) {
			return undefined;
		}
		return {
			type: "oauth",
			access,
			refresh,
			expires,
		};
	}

	const key = typeof record.key === "string"
		? record.key.trim()
		: "";
	if (!key) {
		return undefined;
	}
	return {
		type: "api_key",
		key,
	};
}

export function readResolvedCredentialMap(agentDir: string): StoredCredentialMap {
	const parsed = readJsonRecord(join(agentDir, "auth.json"));
	if (!parsed) {
		return {};
	}
	const credentials: StoredCredentialMap = {};
	for (const [provider, rawCredential] of Object.entries(parsed)) {
		if (!rawCredential || typeof rawCredential !== "object" || Array.isArray(rawCredential)) {
			continue;
		}
		const credential = normalizeStoredCredential(rawCredential as Record<string, unknown>);
		if (!credential) {
			continue;
		}
		credentials[provider] = credential;
	}
	return credentials;
}
