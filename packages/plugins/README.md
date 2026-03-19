# @understudy/plugins

Plugin registry and dynamic loader for Understudy.

## What This Package Does

- **Registry**: `UnderstudyPluginRegistry` manages loaded plugins and collects their contributions (tools, gateway methods, channel factories, CLI commands, hooks, services, platform capabilities, config schemas, diagnostics)
- **Loader**: `loadUnderstudyPlugins()` resolves plugin sources from config, dynamically imports each module, and registers it with the registry
- **Plugin API**: plugins receive an `UnderstudyPluginApi` handle to register tools, gateway methods, channel factories, CLI sub-commands, lifecycle hooks, background services, platform capability metadata, config schemas, and diagnostics

## Exported API

| Export | Kind | Description |
|--------|------|-------------|
| `UnderstudyPluginRegistry` | class | Central registry that holds loaded plugins and their contributions |
| `loadUnderstudyPlugins` | function | Reads `plugins.modules` from config, imports each module, and registers it |
| `UnderstudyPluginModule` | type | Interface a plugin must implement (`id?`, `register(api)`) |
| `UnderstudyPluginApi` | type | API surface passed to `register()` — `registerTool`, `registerGatewayMethod`, `registerChannelFactory`, `registerCli`, `registerHook`, `registerService`, `registerPlatformCapability`, `registerConfigSchema`, `registerDiagnostic` |
| `LoadedUnderstudyPlugin` | type | Metadata for a successfully loaded plugin |
| `UnderstudyPluginCliRegistrar` | type | Callback for registering CLI sub-commands via Commander |
| `UnderstudyPluginGatewayMethodHandler` | type | Handler for custom gateway JSON-RPC methods |

## Usage

This package is internal to the Understudy monorepo and not published separately.

```typescript
import { loadUnderstudyPlugins, UnderstudyPluginRegistry } from "@understudy/plugins";
```

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest
```

## License

MIT
