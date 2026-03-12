#!/usr/bin/env node

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const publishDistDir = path.join(repoRoot, "dist");

const internalEntryPoints = {
	"@understudy/types": path.join(repoRoot, "packages", "types", "dist", "index.js"),
	"@understudy/core": path.join(repoRoot, "packages", "core", "dist", "index.js"),
	"@understudy/channels": path.join(repoRoot, "packages", "channels", "dist", "index.js"),
	"@understudy/gateway": path.join(repoRoot, "packages", "gateway", "dist", "index.js"),
	"@understudy/gui": path.join(repoRoot, "packages", "gui", "dist", "index.js"),
	"@understudy/plugins": path.join(repoRoot, "packages", "plugins", "dist", "index.js"),
	"@understudy/tools": path.join(repoRoot, "packages", "tools", "dist", "index.js"),
};

function escapeRegex(input) {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

await rm(publishDistDir, { recursive: true, force: true });
await mkdir(publishDistDir, { recursive: true });

await build({
	entryPoints: [path.join(repoRoot, "apps", "cli", "dist", "index.js")],
	outfile: path.join(publishDistDir, "index.js"),
	bundle: true,
	format: "esm",
	platform: "node",
	target: "node20",
	packages: "external",
	plugins: [
		{
			name: "understudy-internal-bundle",
			setup(buildApi) {
				for (const [name, resolvedPath] of Object.entries(internalEntryPoints)) {
					buildApi.onResolve(
						{ filter: new RegExp(`^${escapeRegex(name)}$`) },
						() => ({ path: resolvedPath }),
					);
				}
			},
		},
	],
});
