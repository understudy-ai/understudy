# X Launch — Per-Account Talking Points

Research date: 2025-03-13

## Priority Table

| Priority | Account | Reason |
|----------|---------|--------|
| Must @ | @badlogicgames | pi-mono author, Understudy's core dependency |
| Must @ | @rowancheung | Amplifier account, most likely to drive traffic |
| Strong | @simonw | High chance of hands-on review + retweet |
| Strong | @swyx | AI Engineer community core |
| Strong | @yoheinakajima | Agent community OG |
| Worth trying | @openai / @sama / @gdb | Uses Codex + GPT-5.4, worth the @ |
| Worth trying | @karpathy | High bar but the engineering depth may resonate |

---

## @badlogicgames (Mario Zechner) — pi-mono author

**Connection: DIRECT DEPENDENCY — strongest link**

Source code evidence:
- 4 pi-mono packages as core dependencies: `@mariozechner/pi-agent-core` (^0.56.2), `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`
- `AgentTool` type used in 48+ files, 304+ occurrences — the foundation of the entire tool system
- `pi-coding-agent` provides: SessionManager, Skill system, codingTools, AuthStorage, ModelRegistry
- `pi-ai` provides: Model management, getModel(), ThinkingLevel, ImageContent
- `understudy.mjs` maps `PI_CODING_AGENT_DIR` → `~/.understudy/agent`
- README acknowledgment: "pi-mono → Agent core runtime, unified LLM API, TUI infrastructure"

Talking point direction:
> Built on pi-agent-core — the agent loop, session management, skill system, and model abstraction all come from pi-mono. We added 5 layers on top: GUI grounding, teach-by-demonstration, workflow crystallization, route optimization. Your foundation made this possible.

---

## @rowancheung — AI tool amplifier

**Connection: GENERAL — demo-driven showcase**

Specific showable content:
- Showcase demo: teach agent "search image → download → Pixelmator Pro remove background → send via Telegram" across 3 apps (`examples/published-skills/taught-person-photo-cutout-bc88ec/SKILL.md`)
- One-line product definition: "Teach once, reuse forever"
- 13 GUI tools + 8 messaging channels + 47 built-in skills
- Five-layer progression diagram is highly shareable

Talking point direction:
> Teach your computer a task once — it learns the intent, not the coordinates. Show it how to search → edit in Pixelmator → send via Telegram, and it turns that into a reusable skill. No API integrations, no workflow builders.
> Pair with demo GIF/video + five-layer architecture diagram.

---

## @simonw — Hands-on tool reviewer

**Connection: STRONG — multiple interest hits**

Specific hits:
- Open source + runnable: MIT license, `npm install -g @understudy-ai/understudy && understudy wizard`
- Real computer use implementation: 13 GUI tools in `packages/gui/`, complete grounding pipeline (screenshot → HiDPI normalization → grounding model prediction → coordinate space transform → CGEvent execution → verification)
- Dual-model grounding architecture (`packages/tools/src/openai-grounding-provider.ts`): main model decides "what", grounding model uses OpenAI Responses API to decide "where", 30/30 benchmark
- Teach is not macro recording: `buildDemonstrationEvidencePack()` uses ffmpeg scene detection + event clustering + semantic keyframe extraction → three-layer SKILL.md
- Workflow Crystallization (`packages/core/src/workflow-crystallization.ts`): auto-discovers repeated patterns → segment → cluster → synthesize skill — a real agentic engineering pattern to review

Talking point direction:
> Real screenshot-grounded GUI automation on macOS — 13 tools, dual-model grounding (30/30 benchmark), teach-by-demonstration that learns intent not coordinates. The workflow crystallization pipeline auto-discovers repeated patterns and synthesizes reusable skills. Open source, MIT, runs locally.

---

## @swyx — AI Engineer community

**Connection: STRONG — architectural innovations hit AI Engineer interests**

Specific hits:
- Five-layer progressive architecture (Operate → Learn → Remember → Optimize → Anticipate) — a complete agent design paradigm
- Route Pyramid + Route Guard (`packages/core/src/runtime/policies/route-guard-policy.ts`): API > CLI > Browser > GUI, tracks consecutive failures per route, auto-suggests route switching after 2 failures
- Policy Pipeline architecture: every tool call passes through safety → trust → logging hooks
- System prompt `## Tool Routing` explicitly steers toward lightest reliable route
- Crystallization as implicit learning: conversation history → segmentation → episode → clustering → skill synthesis → hot-reload
- Progressive trust model: manual → suggest → auto_with_confirm → full_auto

Talking point direction:
> A 5-layer agent architecture that mirrors how a new hire grows into a reliable colleague. Route pyramid auto-selects API > CLI > browser > GUI. Workflow crystallization turns daily usage into reusable skills without explicit teaching. Progressive trust model — autonomy is earned, not assumed.

---

## @yoheinakajima — Agent community OG

**Connection: MEDIUM-HIGH — autonomous agent philosophy directly relevant**

Specific hits:
- Five-layer progression from "task runner" to "autonomous colleague" directly dialogues with BabyAGI's autonomous agent vision
- Layer 3 Crystallization = implicit learning — agent auto-discovers what to learn from daily use, no explicit instruction needed
- Subagent delegation (`packages/gateway/src/subagent-registry.ts`): parent sessions spawn child agents, supports list/wait/kill/steer
- Layer 5 vision: passive observation → pattern discovery → proactive suggestions → isolated workspace execution
- Build-in-public friendly: honest "implemented vs not implemented" boundaries throughout docs

Talking point direction:
> BabyAGI showed us autonomous task decomposition. Understudy takes a different path: start from human demonstrations, crystallize repeated patterns into skills, then progressively earn autonomy. Layer 3 workflow crystallization is working today — the agent discovers what to learn from daily use, no explicit teaching needed.

---

## @openai / @sama / @gdb — OpenAI ecosystem

**Connection: MEDIUM — actually uses OpenAI products**

Source code evidence:
- Default model: `openai-codex/gpt-5.4` (`packages/types/src/config.ts`)
- GUI grounding calls OpenAI Responses API (`https://api.openai.com/v1/responses`) with `gpt-5.4`
- Supports OpenAI reasoning effort levels: minimal/low/medium/high/xhigh
- Showcase demo environment: "macOS + GPT-5.4 via Codex"
- README acknowledges `openai-cua-sample-app` as computer use agent reference
- Complete grounding pipeline: screenshot → HiDPI normalization (Retina physical → logical) → adaptive scaling (≤2000×2000, ≤4.5MB) → grounding prediction → coordinate transform → small target refinement → complex mode simulation overlay validation → CGEvent execution

Talking point direction:
> Understudy uses GPT-5.4 via Codex as its default model + OpenAI Responses API for screenshot grounding. 13 native GUI tools, dual-model architecture, 30/30 grounding benchmark on macOS. A complete computer-use runtime built on OpenAI's foundation — teach once, reuse forever.

---

## @karpathy — Hardcore technical audience

**Connection: MEDIUM — needs engineering depth to impress**

Technical highlights:
- Dual-model grounding: main model has no pixel-coordinate burden, grounding model has no task context — clean separation of concerns
- Three coordinate spaces: physical pixels → logical points (macOS CGEvent) → model pixels, with complete scaling/transform chain
- Cross-attempt feedback: `groundingFeedback` Map keyed by `[app, scope, action, target]`, retains 2 failure records for 2 minutes, next grounding request carries failure history
- Debounced wait: `gui_wait`'s `probeForTarget()` requires 2 consecutive consistent results to prevent false positives
- Evidence pack construction: ffmpeg scene detection (threshold 0.12) + event clustering (time gap <1100ms, weighted by type) + three-source merge + adaptive budget (up to 18 episodes, 64 keyframes) + semantic keyframes (6 per episode)
- Crystallization pipeline: compact turn → day-level segmentation → episode summarization → cross-history clustering → skill synthesis — a complete dialogue-to-structured-knowledge extraction system

Talking point direction:
> A teachable desktop agent with real engineering depth: dual-model GUI grounding, three coordinate spaces for HiDPI, cross-attempt failure memory, video-first evidence packs with scene detection. The crystallization pipeline turns daily conversations into reusable skills through segmentation → episode extraction → clustering → synthesis.
