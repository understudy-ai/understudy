# Demo: General Agent — One Message, Done

Demonstrates the core product pitch first: Understudy as a general-purpose agent that can handle complex everyday tasks from a single instruction.

## Demo Scenario

**Prompt:** "Research the latest computer use capabilities from OpenAI, Anthropic, xAI (Grok), and Google — covering their research papers, product releases, and technical approaches. Then create a polished PowerPoint presentation for an executive audience. Keep the deck concise and presentation-ready rather than text-heavy. Include: (1) a strong title / thesis slide, (2) one slide per company with a product screenshot or diagram when possible, (3) a side-by-side comparison scorecard covering architecture, grounding method, supported platforms, benchmark scores, and safety approach, (4) a timeline chart showing key releases, and (5) a recommendation / industry outlook slide. Use meaningful visuals across multiple slides; if screenshots are unavailable, create charts or visual summaries instead of falling back to text-only slides. Use only enough current primary sources to support the deck, then build it. Save the final `.pptx` to the Downloads."

**What happens:**
1. Agent searches the web for recent computer use research and product announcements from all four companies
2. Collects key facts: model names, release dates, benchmarks, interaction paradigms, limitations
3. Synthesizes a structured comparison across dimensions (architecture, grounding method, supported platforms, safety approach)
4. Turns the research into a polished `.pptx` with charts and optional screenshots
5. Saves to the user's Downloads

**Expected output:** A complete `.pptx` file with 8-10 slides including:
- Title slide with a computer use screenshot
- One deep-dive slide per company with product screenshot or architecture diagram
- Side-by-side feature comparison table (architecture, grounding, platforms, benchmarks, safety)
- Timeline chart of key releases across all four companies
- Industry outlook slide

## How to Run

```bash
# Start the gateway
understudy gateway

# Send the demo prompt (via webchat or any channel)
# Navigate to http://localhost:23333/webchat
```

Or via API:

```bash
curl -X POST http://localhost:23333/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"text": "Research the latest computer use capabilities from OpenAI, Anthropic, xAI (Grok), and Google — covering their research papers, product releases, and technical approaches. Then create a polished PowerPoint presentation for an executive audience. Keep the deck concise and presentation-ready rather than text-heavy. Include: (1) a strong title / thesis slide, (2) one slide per company with a product screenshot or diagram when possible, (3) a side-by-side comparison scorecard covering architecture, grounding method, supported platforms, benchmark scores, and safety approach, (4) a timeline chart showing key releases, and (5) a recommendation / industry outlook slide. Use meaningful visuals across multiple slides; if screenshots are unavailable, create charts or visual summaries instead of falling back to text-only slides. Use only enough current primary sources to support the deck, then build it. Save the final .pptx to the Downloads.", "channelId": "web", "senderId": "demo"}'
```

## Model

Tested with `anthropic/claude-sonnet-4-6` and `openai-codex/gpt-5.4`.

## Demo Versions

- **Short (60-90s):** Rapid montage — prompt sent → agent working → final file in Downloads
- **Long (5-8min):** Full walkthrough with narration showing tool usage step by step
