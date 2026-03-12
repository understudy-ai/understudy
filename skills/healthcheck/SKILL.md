---
name: healthcheck
description: Host security hardening and risk-tolerance guidance for Understudy deployments. Use when a user asks for security audits, firewall/SSH/update hardening, exposure review, or recurring checks on a machine running Understudy.
metadata: { "understudy": { "emoji": "🩺" } }
---

# Understudy Host Hardening

## Overview

Assess the host that runs Understudy, keep host controls separate from Understudy configuration, and require explicit approval before any change.

## Core Rules

- Start with read-only checks.
- Require explicit approval before any state-changing action.
- Do not modify remote access settings until the current access path is confirmed.
- Prefer reversible changes with a rollback plan.
- Never claim Understudy itself changes the host firewall, SSH policy, or OS update settings.
- If identity or role is unclear, provide recommendations only.
- Present user choices as numbered lists.

## Read-Only Workflow

1. Establish context:
   - OS and version
   - local console vs SSH/RDP/tunnel/tailnet access
   - admin/root availability
   - public exposure, reverse proxy, or private-only reachability
   - backups, disk encryption, and automatic security updates
2. Run host checks:
   - `uname -a`, `sw_vers`, `cat /etc/os-release`
   - Linux: `ss -ltnup`, `ufw status`, `firewall-cmd --state`, `nft list ruleset`
   - macOS: `lsof -nP -iTCP -sTCP:LISTEN`, `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`, `pfctl -s info`
   - macOS backups: `tmutil status`
3. Run Understudy checks:
   - `understudy security --audit`
   - `understudy status --json`
   - `understudy health --json`
   - `understudy logs --tail 100`
   - `understudy doctor --deep` when broader local diagnostics are needed

Ask once for permission to run read-only checks. If granted, infer as much as possible from commands before asking follow-up questions.

## Risk Profiles

Offer one of these numbered defaults after the host context is known:

1. Home / workstation balanced
2. Remote / headless hardened
3. Developer convenience with explicit exposure warnings
4. Custom constraints supplied by the user

## Remediation Plan

Always present the plan before making changes. Include:

- target profile
- current posture summary
- gaps vs target
- exact commands to run
- rollback or access-preservation notes
- credential and file-permission hygiene notes

## Execution Rules

For each state-changing step:

- show the exact command first
- explain impact and rollback
- confirm remote access will remain available
- stop on unexpected output

Require explicit approval for:

- firewall changes
- opening or closing ports
- SSH or RDP configuration changes
- package installation or removal
- enabling or disabling services
- user or group changes
- scheduled jobs or persistence
- access to sensitive files or credentials

## Verification

After any change, re-check:

- firewall status
- listening ports
- remote access still works
- `understudy security --audit`

Deliver a final posture summary and note any deferred items.

## Periodic Checks

Use Understudy's canonical scheduling surfaces:

- In agent/runtime workflows: use the `schedule` tool with actions `status`, `create`, `list`, `update`, `remove`, `run`, `runs`
- For explicit manual CLI instructions: use the real `understudy schedule` command with supported flags such as `--status`, `--list`, `--add`, `--update`, `--remove`, `--run`, and `--runs`
- Prefer stable job names:
  - `healthcheck:security-audit`
  - `healthcheck:status-snapshot`
- Before creating or updating, inspect existing jobs with `schedule` action `"list"` or `understudy schedule --list`.
- Example recurring commands:
  - weekly `understudy security --audit`
  - daily `understudy status --json`

Do not create recurring jobs without explicit approval.

## Command Accuracy

Use only commands that exist in this repo:

- `understudy security --audit`
- `understudy status --json`
- `understudy health --json`
- `understudy logs --tail 100`
- `understudy doctor --deep`

Do not invent `understudy update status`, `understudy cron ...`, unsupported `schedule` subcommands, or flags that are not in this repo.

## Recordkeeping

If the user wants an audit trail, record:

- plan ID and timestamp
- approved steps and exact commands
- exit codes and files modified (best effort)
- redacted findings only

Never log tokens or full credential contents.

## Memory Writes (Conditional)

Only write to memory files when the user explicitly opts in and the session is private or local.
If memory is requested:

- append dated notes to `memory/YYYY-MM-DD.md`
- update `MEMORY.md` only for durable preferences such as risk posture or allowed ports
- redact hostnames, IPs, usernames, serials, service names, and secrets

If the session cannot write to the workspace, provide a redacted summary the user can store manually.
