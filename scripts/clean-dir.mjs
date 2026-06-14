#!/usr/bin/env node

import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const targets = process.argv.slice(2);

if (targets.length === 0) {
	console.error("Usage: node scripts/clean-dir.mjs <path> [more paths...]");
	process.exit(1);
}

await Promise.all(
	targets.map(async (target) => {
		await rm(resolve(process.cwd(), target), {
			force: true,
			recursive: true,
		});
	}),
);
