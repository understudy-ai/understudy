# @understudy/gateway

HTTP + WebSocket gateway server for Understudy.

## What This Package Does

- **Gateway server**: Express.js HTTP + `ws` WebSocket on a single port (default 23333)
- **JSON-RPC protocol**: extensible handler registry with 40+ built-in RPC methods
- **Session runtime**: manages session state, agent turn execution, tool binding, traces, and memory
- **Teach orchestration**: demonstration recording, video analysis, clarification, validation, and skill publishing
- **Playbook runtime**: staged `playbook` execution across `skill`, `worker`, `inline`, and approval stages
- **Worker runtime**: contract-driven worker launches with budgets, allowed surfaces, and explicit output contracts
- **WebChat UI**: embedded SPA for real-time chat with session management
- **Control UI (Dashboard)**: embedded SPA for gateway control, session inspection, playbook-run inspection, and health monitoring
- **Channel policy**: per-channel tool preset adjustments and identity enforcement
- **Run registry**: agent turn execution tracking with TTL-based cleanup

## Key Files

| File | Purpose |
|------|---------|
| `server.ts` | Gateway HTTP/WS server setup and lifecycle |
| `session-runtime.ts` | Core session management and agent execution |
| `webchat-ui.ts` | Embedded WebChat SPA |
| `control-ui.ts` | Embedded Dashboard SPA |
| `playbook-runtime.ts` | Generic staged playbook orchestration |
| `worker-runtime.ts` | Contract-driven worker stage launcher |
| `skill-runtime.ts` | Workspace skill stage launcher |
| `inline-runtime.ts` | Inline stage launcher |
| `protocol.ts` | Request/response/event type definitions |
| `handler-registry.ts` | RPC method registration and dispatch |
| `channel-policy.ts` | Channel-specific policy overrides |
| `handlers/` | Domain-specific RPC handler implementations |

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest
```
