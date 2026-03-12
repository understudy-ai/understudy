# @understudy/channels

Channel adapters for Understudy — connect agents to messaging platforms.

## Supported Channels

| Channel | Library | Auth Method |
|---------|---------|-------------|
| Web | Built-in WebSocket | Gateway token |
| Telegram | grammy | Bot token |
| Discord | discord.js | Bot token |
| Slack | @slack/bolt | Bot token + signing secret |
| WhatsApp | @whiskeysockets/baileys | QR code pairing |
| Signal | signal-cli | CLI binary + phone number |
| LINE | REST API | Channel access token |
| iMessage | macOS Messages.app | Local (macOS only) |

## Architecture

All channels implement the `ChannelAdapter` interface from `@understudy/types`:

```typescript
interface ChannelAdapter {
  id: string;
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  messaging: ChannelMessagingAdapter;   // send, edit, delete, react
  auth?: ChannelAuthAdapter;            // login/logout
  streaming?: ChannelStreamingAdapter;  // chunked responses
  capabilities: ChannelCapabilities;    // feature flags
}
```

Channels are registered via a factory pattern and instantiated from config:

```typescript
registerChannelFactory("telegram", createTelegramChannel);
const channels = await buildChannelsFromConfig(config);
```

Runtime features: auto-reconnect with exponential backoff, pairing code verification, and per-channel runtime state tracking.

## Development

```bash
pnpm build      # tsc -p tsconfig.build.json
pnpm typecheck  # tsc --noEmit
pnpm test       # vitest
```
