---
scenario: theokit-file-based-config
date: 2026-07-14
operator: paulo
outcome: pass
summary: showcase agent discovers a .theokit/ file-based skill via .settingSources(['project']) — real browser
---

# Dogfood — theokit file-based config (`.theokit/` via `settingSources`)

## Setup

- `apps/showcase/agents/chat.ts` opts in: `.settingSources(['project'])` (the new T1.1 builder method).
- `apps/showcase/.theokit/` created with all six discoverable file types:
  - `skills/release-notes/SKILL.md` (a skill), `agents/code-reviewer.md` (a subagent),
    `context/project.md` (context), `hooks.json` (safe no-op — `node -e "process.exit(0)"`, EC-2),
    `mcp.json` (empty documented example, offline-safe, EC-2), `cron/jobs.json` (no active jobs, EC-7).
- Workspace `@theokit/agents` + `theokit` dist overlaid into the showcase (unpublished changes);
  `@theokit/sdk@3.5.0`; provider = OpenRouter (`.env`).

## Evidence

`theokit dev` started on `http://localhost:3000/` with **no `ConfigurationError`** (all `.theokit/` files parse).

Real browser (Chrome DevTools MCP). Sent: **"List every skill you have available, by name. Just the names."**

Agent replied:

```
- release-notes
- daily-briefing
```

- `daily-briefing` — the INLINE skill (`.skills([dailyBriefingSkill])`, code).
- `release-notes` — the FILE-BASED skill discovered from `.theokit/skills/release-notes/SKILL.md`.

Zero console errors during the run.

## What this proves (the full wiring, end-to-end)

`.settingSources(['project'])` (T1.1) → compiled to `CompiledAgentOptions.settingSources` (T1.2) →
`assembleM8CreateOptions` projected it into `Agent.create({ local: { settingSources: ['project'] } })`
DECOUPLED from inline skills and merged with the app-root `cwd` (T2.1) → `mountAgent` threaded the
framework-resolved `projectRoot` as `local.cwd` (T2.2, EC-1) → the SDK discovered
`.theokit/skills/release-notes/SKILL.md` under the app root and injected it into the agent's `<skills>`
block → the model listed it alongside the inline skill.

The SDK owns discovery + execution (G2 / ADR-0040); theokit only wired `local.settingSources` + `cwd`.
