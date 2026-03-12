import { readFile } from "node:fs/promises";

type UpdateFileChunk = {
	changeContext?: string;
	oldLines: string[];
	newLines: string[];
	isEndOfFile: boolean;
};

export async function applyUpdateHunk(
	filePath: string,
	chunks: UpdateFileChunk[],
	options?: { readFile?: (filePath: string) => Promise<string> },
): Promise<string> {
	const reader = options?.readFile ?? (async (target: string) => readFile(target, "utf8"));
	const originalContents = await reader(filePath).catch((error) => {
		throw new Error(`Failed to read file to update ${filePath}: ${String(error)}`);
	});

	const originalLines = originalContents.split("\n");
	if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
		originalLines.pop();
	}

	const replacements = computeReplacements(originalLines, filePath, chunks);
	let newLines = applyReplacements(originalLines, replacements);
	if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
		newLines = [...newLines, ""];
	}
	return newLines.join("\n");
}

function computeReplacements(
	originalLines: string[],
	filePath: string,
	chunks: UpdateFileChunk[],
): Array<[number, number, string[]]> {
	const replacements: Array<[number, number, string[]]> = [];
	let lineIndex = 0;

	for (const chunk of chunks) {
		if (chunk.changeContext) {
			const ctxIndex = seekSequence(originalLines, [chunk.changeContext], lineIndex, false);
			if (ctxIndex === null) {
				throw new Error(`Failed to find context '${chunk.changeContext}' in ${filePath}`);
			}
			lineIndex = ctxIndex + 1;
		}

		if (chunk.oldLines.length === 0) {
			const insertionIndex =
				originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
					? originalLines.length - 1
					: originalLines.length;
			replacements.push([insertionIndex, 0, chunk.newLines]);
			continue;
		}

		let pattern = chunk.oldLines;
		let newSlice = chunk.newLines;
		let found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);

		if (found === null && pattern[pattern.length - 1] === "") {
			pattern = pattern.slice(0, -1);
			if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
				newSlice = newSlice.slice(0, -1);
			}
			found = seekSequence(originalLines, pattern, lineIndex, chunk.isEndOfFile);
		}

		if (found === null) {
			throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.oldLines.join("\n")}`);
		}

		replacements.push([found, pattern.length, newSlice]);
		lineIndex = found + pattern.length;
	}

	replacements.sort((a, b) => a[0] - b[0]);
	return replacements;
}

function applyReplacements(
	lines: string[],
	replacements: Array<[number, number, string[]]>,
): string[] {
	const result = [...lines];
	for (const [startIndex, oldLen, newLines] of [...replacements].toReversed()) {
		for (let i = 0; i < oldLen; i += 1) {
			if (startIndex < result.length) {
				result.splice(startIndex, 1);
			}
		}
		for (let i = 0; i < newLines.length; i += 1) {
			result.splice(startIndex + i, 0, newLines[i]);
		}
	}
	return result;
}

function seekSequence(
	lines: string[],
	pattern: string[],
	start: number,
	eof: boolean,
): number | null {
	if (pattern.length === 0) {
		return start;
	}
	if (pattern.length > lines.length) {
		return null;
	}

	const maxStart = lines.length - pattern.length;
	const searchStart = eof && lines.length >= pattern.length ? maxStart : start;
	if (searchStart > maxStart) {
		return null;
	}

	for (let i = searchStart; i <= maxStart; i += 1) {
		if (linesMatch(lines, pattern, i, (value) => value)) {
			return i;
		}
	}
	for (let i = searchStart; i <= maxStart; i += 1) {
		if (linesMatch(lines, pattern, i, (value) => value.trimEnd())) {
			return i;
		}
	}
	for (let i = searchStart; i <= maxStart; i += 1) {
		if (linesMatch(lines, pattern, i, (value) => value.trim())) {
			return i;
		}
	}

	return null;
}

function linesMatch(
	lines: string[],
	pattern: string[],
	start: number,
	normalize: (value: string) => string,
): boolean {
	for (let idx = 0; idx < pattern.length; idx += 1) {
		if (normalize(lines[start + idx]) !== normalize(pattern[idx])) {
			return false;
		}
	}
	return true;
}
