#!/usr/bin/env node

import { ensureBootstrapRuntimeAgentDirEnv } from "./early-agent-dir.js";

ensureBootstrapRuntimeAgentDirEnv();

await import("./index.js");
