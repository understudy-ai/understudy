---
name: discord
description: "Discord messaging via `message_send` (channel=discord). Use for outbound sends, replies, edits, reactions, deletes, and attachment sends on Discord."
metadata: { "understudy": { "emoji": "🎮", "requires": { "config": ["channels.discord.token"] } } }
allowed-tools: ["message_send"]
---

# Discord (Via `message_send`)

Use the `message_send` tool. Understudy does not expose a separate provider-specific `discord` tool.

## Musts

- Always: `channel: "discord"`.
- Use the canonical `message_send` schema: `recipient`, `text`, `threadId`, `replyTo`, `messageId`, `emoji`, `attachmentUrl`, `attachmentType`, `attachmentName`, `attachmentMimeType`.
- Prefer explicit ids in the recipient string when possible, for example `channel:1234567890` or `user:1234567890`.

## Guidelines

- Avoid Markdown tables in outbound Discord messages.
- Mention users as `<@USER_ID>`.
- Keep Discord actions within the current Understudy tool surface. Do not invent unsupported fields such as `components`, `embeds`, `pollQuestion`, `thread-create`, `search`, or `set-presence`.

## Targets

- Send-like actions: `recipient: "channel:<id>"` or `recipient: "user:<id>"`.
- Message-specific actions: use `messageId`, and include `recipient` when the adapter needs target context.

## Common Actions (Examples)

Send message:

```json
{
  "action": "send",
  "channel": "discord",
  "recipient": "channel:123",
  "text": "hello"
}
```

Reply to a message:

```json
{
  "action": "reply",
  "channel": "discord",
  "recipient": "channel:123",
  "replyTo": "456",
  "text": "Thanks, looking now."
}
```

Send with attachment:

```json
{
  "action": "sendAttachment",
  "channel": "discord",
  "recipient": "channel:123",
  "text": "see attachment",
  "attachmentUrl": "/tmp/example.png",
  "attachmentType": "image",
  "attachmentName": "example.png"
}
```

```json
{
  "action": "edit",
  "channel": "discord",
  "recipient": "channel:123",
  "messageId": "456",
  "text": "fixed typo"
}
```

```json
{
  "action": "react",
  "channel": "discord",
  "recipient": "channel:123",
  "messageId": "456",
  "emoji": "✅"
}
```

```json
{
  "action": "delete",
  "channel": "discord",
  "recipient": "channel:123",
  "messageId": "456"
}
```

If you need polls, search, thread creation, pins, moderation, or presence changes, tell the user the current Understudy tool surface does not expose those Discord-specific operations directly.

## Writing Style (Discord)

- Short, conversational, low ceremony.
- No markdown tables.
- Mention users as `<@USER_ID>`.
