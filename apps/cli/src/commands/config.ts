/**
 * Configuration management command.
 */

import { ConfigManager, getDefaultConfigPath } from "@understudy/core";
import { buildNestedPatch } from "./gateway-support.js";

interface ConfigOptions {
	show?: boolean;
	set?: string;
	path?: boolean;
	config?: string;
}

export async function runConfigCommand(opts: ConfigOptions = {}): Promise<void> {
	if (opts.path) {
		console.log(getDefaultConfigPath());
		return;
	}

	const configManager = await ConfigManager.load(opts.config);
	const config = configManager.get();

	if (opts.show || (!opts.set && !opts.path)) {
		console.log(JSON.stringify(config, null, 2));
		return;
	}

	if (opts.set) {
		const eqIdx = opts.set.indexOf("=");
		if (eqIdx === -1) {
			console.error("Format: --set key=value");
			process.exit(1);
		}
		const key = opts.set.slice(0, eqIdx);
		const value = opts.set.slice(eqIdx + 1);

		configManager.update(buildNestedPatch(key, tryParseValue(value)) as any);
		configManager.save();
		console.log(`Set ${key} = ${value}`);
	}
}

function tryParseValue(value: string): unknown {
	if (value === "true") return true;
	if (value === "false") return false;
	const num = Number(value);
	if (!isNaN(num)) return num;
	return value;
}
