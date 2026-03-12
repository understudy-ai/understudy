import { asRecord, asString } from "@understudy/core";

export function buildDataUrl(mimeType: string, bytes: Buffer): string {
	return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

export function extractResponseText(payload: unknown): string {
	const root = asRecord(payload);
	if (!root) return "";
	const direct = asString(root.output_text);
	if (direct) return direct;

	const output = Array.isArray(root.output) ? root.output : [];
	const parts: string[] = [];
	for (const item of output) {
		const itemRecord = asRecord(item);
		if (!itemRecord) continue;
		const content = Array.isArray(itemRecord.content) ? itemRecord.content : [];
		for (const block of content) {
			const blockRecord = asRecord(block);
			if (!blockRecord) continue;
			const text = asString(blockRecord.text) ?? asString(blockRecord.output_text);
			if (text) {
				parts.push(text);
			}
		}
	}
	if (parts.length > 0) {
		return parts.join("\n").trim();
	}

	const error = asRecord(root.error);
	if (error) {
		const message = asString(error.message);
		if (message) {
			throw new Error(message);
		}
	}
	return "";
}

function extractBalancedJsonObject(text: string): string | undefined {
	const start = text.indexOf("{");
	if (start < 0) {
		return undefined;
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\" && inString) {
			escaped = true;
			continue;
		}
		if (char === "\"") {
			inString = !inString;
			continue;
		}
		if (inString) {
			continue;
		}
		if (char === "{") {
			depth += 1;
			continue;
		}
		if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return text.slice(start, index + 1).trim();
			}
		}
	}
	return undefined;
}

export function extractJsonObject<T = Record<string, unknown>>(
	text: string,
	label = "Response",
): T {
	const trimmed = text.trim();
	const candidates = [trimmed];
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	if (fenced) {
		candidates.push(fenced.trim());
	}
	const balanced = extractBalancedJsonObject(trimmed);
	if (balanced) {
		candidates.push(balanced);
	}
	const brace = trimmed.match(/\{[\s\S]*\}/)?.[0];
	if (brace) {
		candidates.push(brace.trim());
	}
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			const record = asRecord(parsed);
			if (record) {
				return record as T;
			}
		} catch {
			// Try the next candidate.
		}
	}
	throw new Error(`${label} was not valid JSON: ${trimmed.slice(0, 200)}`);
}
