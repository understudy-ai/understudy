# Demo: Computer Use + Remote Dispatch — Agent on Desktop, You on Phone

Demonstrates Cowork-style computer use in practice: you send tasks from a phone via messaging apps while Understudy executes browser, GUI, shell, and file work on your Mac.

## Demo Scenario

**Channel:** Telegram (also works with Discord, Slack, WhatsApp, Signal, LINE, iMessage, Web)

**Flow:**
1. User sends a Telegram message from their phone
2. Understudy gateway receives it on the Mac
3. Agent executes: opens browser, searches, clicks through desktop apps when needed, creates files, etc.
4. Agent replies with results back to Telegram

**Example prompts:**
- "Open Safari and search for the weather in San Francisco, tell me the temperature"
- "Create meeting-notes.txt on my Desktop with today's agenda"
- "Research the latest funding rounds in AI this week and write a summary"

## How to Run

```bash
# 1. Configure Telegram bot via wizard
understudy wizard

# 2. Start the gateway
understudy gateway

# 3. Send messages from your phone's Telegram to the bot
```

## Comparison with Claude Dispatch

| Feature | Understudy | Claude Dispatch |
|---------|-----------|-----------------|
| Channels | 8 (Telegram, Slack, Discord, WhatsApp, Signal, LINE, iMessage, Web) | Claude iOS app only |
| Setup | Standard bot token per channel | QR code pairing |
| GUI automation | Full native macOS | Full native macOS |
| Learn from demo | Yes (teach) | No |
| Model | Any (Claude, GPT, Gemini) | Claude only |

## Demo Versions

- **Short (60-90s):** Split-screen — phone on left, Mac on right. Send message → watch agent work → receive reply
- **Long (5-8min):** Setup walkthrough + multiple tasks across channels
