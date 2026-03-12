# Contributing to Understudy

Thanks for your interest in Understudy! Whether it's a bug fix, new skill, documentation improvement, or a whole new GUI backend — every contribution makes the project better.

## Where to Start

Not sure where to begin? Here are the areas where help is most needed:

| Area | What's needed | Good first issue? |
|------|--------------|:-----------------:|
| **GUI backends** | Linux (AT-SPI) and Windows (UIA) native GUI support | |
| **Skills** | New skill modules for popular apps and workflows | ✅ |
| **Route discovery** | Automatic API detection and upgrade logic (Layer 4) | |
| **Teach improvements** | Better evidence pack analysis, validation, edge cases | |
| **Documentation** | Guides, tutorials, translations | ✅ |
| **Bug fixes** | Check the issue tracker for reported bugs | ✅ |
| **Tests** | More coverage for tools, skills, and gateway | ✅ |

Look for issues labeled `good first issue` or `help wanted` in the issue tracker.

## Development Setup

**Prerequisites:** Node.js >= 20.6, pnpm >= 10

```bash
git clone https://github.com/understudy-ai/understudy.git
cd understudy
pnpm install
```

**Validate your setup:**

```bash
pnpm build        # build all packages
pnpm lint         # oxlint
pnpm typecheck    # TypeScript strict mode
pnpm test         # unit + integration tests
```

**Run the full check (same as CI):**

```bash
pnpm check        # build + lint + typecheck + test
```

**Optional (for GUI / teach features):**

- macOS + Xcode CLI Tools — native GUI automation
- Chrome — extension relay browser mode
- ffmpeg + ffprobe — teach-by-demonstration video analysis

## Repository Layout

```
apps/cli           CLI entrypoints, 30+ operator commands
packages/core      Agent session runtime, config, auth, skills, policies
packages/gateway   HTTP + WebSocket gateway, session runtime, web surfaces
packages/gui       Native GUI runtime, screenshot grounding, demo recorder
packages/tools     Built-in tools: browser, web, memory, schedule, GUI, message
packages/channels  Channel adapters (8 platforms)
packages/types     Shared TypeScript type definitions
skills/            47 built-in skill modules
docs/              product design documentation, Pages
```

## Branching & Pull Requests

**Branching:**

- Create feature branches from `main`
- Use descriptive names: `feat/linux-gui-backend`, `fix/teach-video-parsing`, `docs/quick-start-guide`

**Before opening a PR:**

1. Run `pnpm check` and make sure everything passes
2. Add tests for new behavior and bug fixes
3. Update docs if behavior or APIs change

**PR should include:**

- A concise summary of what changed and why
- Test evidence (commands run + results, or screenshots for GUI changes)
- Notes on behavior changes and migration impact (if any)

## Coding Guidelines

- **TypeScript only** (ESM, strict mode)
- **Small focused modules** — prefer composition over monoliths
- **Explicit over implicit** — no magic, no hidden state
- **Test what matters** — especially tool execution, skill parsing, and gateway routing

## Commit Style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(gateway): add webchat route
fix(cli): handle missing api key gracefully
test(tools): add memory tool coverage
docs(readme): update quick start section
refactor(gui): extract grounding into separate module
```

## Writing Skills

Skills are one of the easiest ways to contribute. Each skill is a `SKILL.md` file with YAML frontmatter:

```yaml
---
name: my-skill
description: What this skill does
tools: [bash, browser, web_fetch]
---

# Instructions for the agent when this skill is activated
...
```

See `skills/` for examples. Skills can be submitted as PRs and will be reviewed for quality and safety.

## Contributor License Agreement

By submitting a pull request, you agree to the terms in [CLA.md](./CLA.md). In short: you grant the project a license to use your contribution, and you confirm you have the right to do so.

## Code of Conduct

Be kind. Be constructive. Assume good faith. We're building something together.

## Questions?

Open a [Discussion](https://github.com/understudy-ai/understudy/discussions) or join us on [Discord](https://discord.gg/understudy).
