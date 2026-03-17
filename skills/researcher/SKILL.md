---
name: researcher
description: Research current topics with multiple sources and produce a structured brief, comparison, recommendation, or fact-check. Use when the user asks for investigation, market/product landscape scans, option evaluation, due diligence, source-backed validation, or a research report. Do not use for summarizing a single provided URL/document, or for GitHub issue/PR operations.
metadata:
  understudy:
    triggers:
      - "research this"
      - "look into this and compare options"
      - "do a landscape scan"
      - "fact-check this and give me sources"
---

# Researcher

Use this skill for bounded, source-backed research.

Default goal: turn an open-ended question into a concise research output with explicit evidence, tradeoffs, and uncertainty.

## When to use

Use this skill when the user wants any of:

- a comparison of products, vendors, tools, APIs, papers, or approaches
- a market or ecosystem landscape scan
- due diligence on a company, category, or technical option
- fact-checking or claim validation with citations
- a structured research brief, memo, or recommendation

Do not use this skill for:

- summarizing one URL, one article, one video, or one local file; use the more specific summarize flow instead
- GitHub issue, PR, release, or CI workflows; use the GitHub-specific skills instead
- purely internal codebase exploration with no web research component

## Working style

Prefer current sources over memory. Use a small search budget first, then expand only if the evidence is weak or conflicting.

Unless the user already gave a narrow format, produce:

1. Research goal
2. Short answer or recommendation
3. Comparison or findings
4. Risks, caveats, and unknowns
5. Sources

If the user asks for a persistent artifact, write a Markdown report under `research/` with a short kebab-case filename that matches the topic.

## Workflow

Follow these phases in order.

### 1. Frame the question

Before searching, extract or infer:

- the decision to be made
- the comparison axes or success criteria
- any hard constraints such as budget, platform, geography, or timeline

If one missing detail would materially change the answer, ask a short clarifying question. Otherwise proceed with a stated assumption.

### 2. Make a research plan

Break the work into 3-7 subquestions. Keep them concrete and decision-relevant.

Examples:

- What options belong in scope?
- What are the meaningful differences?
- What evidence is primary vs secondary?
- What risks or hidden costs matter?

### 3. Use a bounded search budget

Start with a tight first pass:

- 2-4 targeted searches to map the space
- fetch the strongest candidate sources
- expand only if the first pass is incomplete, outdated, or contradictory

Avoid aimless searching. Stop when additional searches are no longer changing the answer.

### 4. Prefer stronger evidence

When possible, prioritize:

- official product or vendor documentation
- original papers, specs, standards, or release notes
- first-party pricing or policy pages
- reputable primary reporting or direct statements

Use secondary summaries only to discover leads, not as the sole basis for important conclusions.

### 5. Compare and validate

For each important claim:

- note which source supports it
- look for disagreement or missing context
- cross-check high-impact claims with at least two independent sources when feasible

Call out any inference you are making from the evidence instead of presenting it as a confirmed fact.

### 6. Produce a decision-ready output

Keep the final answer structured and useful. Include:

- the answer up front
- a short comparison table or bullets when multiple options are involved
- the strongest evidence and why it matters
- explicit uncertainty, recency limits, and open questions
- source links or source identifiers

## Output templates

### Comparison / recommendation

Use this shape by default:

- Recommendation
- Why it wins
- Alternatives considered
- Key risks or tradeoffs
- Sources

### Fact-check / validation

Use this shape:

- Verdict: supported / mixed / unsupported / unclear
- What the evidence says
- What remains uncertain
- Sources

### Landscape scan

Use this shape:

- Category snapshot
- Main players or approaches
- How they differ
- Notable gaps, risks, or trends
- Recommendation or next step
- Sources

## Tool guidance

Prefer `web_search` to discover candidates, `web_fetch` to read exact page contents, and `pdf` when a primary source is a PDF.

Use the browser only when a relevant source requires interactive navigation, login, or a page state that the normal web tools cannot reach.

## Quality bar

Do not end with a pile of links. Synthesize.

Do not present stale or weakly supported claims as settled.

Do not hide uncertainty. If the evidence is thin, say so clearly and narrow the recommendation.
