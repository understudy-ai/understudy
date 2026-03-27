# Demo: Teach — Show Once, Automate Forever

Demonstrates Understudy's distinctive learn-from-demonstration stack: teach once, publish a reusable artifact, then replay it later. The same machinery also supports daily workflow crystallization and route-aware reuse.

## Demo Scenario

**Task taught:** Search for a person's photo → open in Pixelmator Pro → remove background → export → send via Telegram.

**Flow:**
1. Start teach recording: `/teach start`
2. Human demonstrates the task once with mouse and keyboard
3. Stop recording: `/teach stop "Remove background from a photo and send via Telegram"`
4. AI analyzes recording → extracts intent, parameters, steps, success criteria
5. Review and refine the draft
6. Publish: `/teach publish <draftId> photo-cutout-telegram`
7. Test autonomous replay: "Remove the background from a photo of a sunset and send it to my Telegram"

**Key insight:** Understudy learns **intent**, not coordinates. The published skill survives UI redesigns, window resizing, even switching to a similar app.

## Published Skill Example

The published SKILL.md from this demo is available at:
[`../published-skills/taught-create-a-background-removed-portrait-for-a-requested-person-and-send-it-in-telegram-cd861a/SKILL.md`](../published-skills/taught-create-a-background-removed-portrait-for-a-requested-person-and-send-it-in-telegram-cd861a/SKILL.md)

## Prerequisites

- Pixelmator Pro installed
- Telegram bot configured
- Google Chrome for image search

## How to Run

```bash
# Start the gateway
understudy gateway

# Open webchat
open http://localhost:23333/webchat

# In the chat:
# 1. Type: /teach start
# 2. Demonstrate the task
# 3. Type: /teach stop "Remove background from a photo and send via Telegram"
# 4. Type: /teach publish <draftId>

# Test replay:
# "Find a photo of a mountain landscape, remove the background, and send it to my Telegram"
```

## Demo Versions

- **Short (60-90s):** `/teach start` → quick demo → `/teach stop` → publish → autonomous replay
- **Long (5-8min):** Full flow with analysis review, skill inspection, and multiple replays
