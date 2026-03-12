import type { RuntimePoliciesConfig, RuntimePolicyModuleConfig } from "@understudy/types";
import type { RuntimePolicy, RuntimePolicyContext } from "./policy-pipeline.js";
import {
	builtInRuntimePolicyFactories,
	DEFAULT_RUNTIME_POLICY_MODULE_ORDER,
	type RuntimePolicyModuleFactory,
} from "./policies/index.js";

export interface RuntimePolicyRegistryOptions {
	onModuleMissing?: (moduleName: string) => void;
}

export interface RuntimePolicyBuildOptions {
	context: RuntimePolicyContext;
	config?: RuntimePoliciesConfig;
}

export interface RuntimePolicyBuildResult {
	policies: RuntimePolicy[];
	modules: string[];
}

export class RuntimePolicyRegistry {
	private readonly modules = new Map<string, RuntimePolicyModuleFactory>();
	private readonly onModuleMissing?: RuntimePolicyRegistryOptions["onModuleMissing"];

	constructor(options: RuntimePolicyRegistryOptions = {}) {
		this.onModuleMissing = options.onModuleMissing;
	}

	register(name: string, factory: RuntimePolicyModuleFactory): void {
		this.modules.set(name, factory);
	}

	registerMany(factories: Record<string, RuntimePolicyModuleFactory>): void {
		for (const [name, factory] of Object.entries(factories)) {
			this.register(name, factory);
		}
	}

	has(name: string): boolean {
		return this.modules.has(name);
	}

	list(): string[] {
		return Array.from(this.modules.keys());
	}

	async build(options: RuntimePolicyBuildOptions): Promise<RuntimePolicyBuildResult> {
		const policyConfig = options.config;
		if (policyConfig?.enabled === false) {
			return { policies: [], modules: [] };
		}

		const modules = this.resolveModules(policyConfig);
		const loadedModules: string[] = [];
		const policies: RuntimePolicy[] = [];

		for (const moduleConfig of modules) {
			if (moduleConfig.enabled === false) continue;
			const factory = this.modules.get(moduleConfig.name);
			if (!factory) {
				this.onModuleMissing?.(moduleConfig.name);
				continue;
			}
			const created = await factory({ options: moduleConfig.options });
			const current = Array.isArray(created) ? created : [created];
			policies.push(...current);
			loadedModules.push(moduleConfig.name);
		}

		return {
			policies,
			modules: loadedModules,
		};
	}

	private resolveModules(config?: RuntimePoliciesConfig): RuntimePolicyModuleConfig[] {
		if (config?.modules?.length) {
			return config.modules;
		}
		return DEFAULT_RUNTIME_POLICY_MODULE_ORDER.map((name) => ({
			name,
			enabled: true,
		}));
	}
}

export function createDefaultRuntimePolicyRegistry(
	options: RuntimePolicyRegistryOptions = {},
): RuntimePolicyRegistry {
	const registry = new RuntimePolicyRegistry(options);
	registry.registerMany(builtInRuntimePolicyFactories);
	return registry;
}

