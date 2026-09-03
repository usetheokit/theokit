---
'create-theokit': minor
---

**A generated app now demonstrates all five TheoKit concepts — agents, tools, skills, hooks, rules
and personalities — with each one wired rather than merely present.**

The scaffold shipped agents, tools, prompts and skills, and nothing at all for the other three. An
app that shows half the framework teaches half the framework, and the missing half is the half a
user is least likely to discover on their own: it lives in files the framework reads at runtime,
which nothing in a project points at.

## The split the layout now makes visible

```
src/server/agents/     CODE — compiled, changes on deploy
├── chat.ts  tools/  prompts/  skills/
└── hooks/             ← new

.theokit/              DATA — read at runtime, no rebuild
├── THEO.md            ← new: facts true on every turn
├── rules/             ← new: instructions scoped to file globs
└── personalities/     ← new: swappable system prompts
```

Tone and domain facts move at a different speed than code. Shipping a deploy to reword a system
prompt is a bad trade, and the two directories are what make the difference obvious.

## What each one is

- **`hooks/tool-audit.ts`** — one structured log line per tool call, with its duration, attached in
  `chat.ts` via `.hooks()`. It deliberately does **not** veto: `pre_tool_call` is the only hook with
  veto power, and any policy a template invented would be one the app never chose. The docblock
  shows the veto shape for when you have a rule of your own, and `send_notification` stays gated the
  right way — by a human approval.
- **`.theokit/rules/*.md`** — path-scoped instructions, activated by `globs` in the frontmatter
  (`description` / `paths` / `globs` / `alwaysApply` / `enabled`). A file with no frontmatter is
  treated as `alwaysApply: true`, which the README calls out because a typo'd key silently turns a
  scoped rule into an always-on one.
- **`.theokit/personalities/*.md`** — frontmatter describes the preset, the body IS the system
  prompt. Switched at runtime with `agent.usePersonality('teacher', { save: true })`. `none`,
  `default` and `neutral` are reserved names that clear it — so the test asserts no shipped
  personality uses one, since such a file could never be selected.
- **`.theokit/THEO.md`** — prepended every turn. Highest priority in the file layer (60), which is
  why it holds facts rather than preferences: a preference that always wins cannot be overridden by
  a personality.

The ARCHITECTURE doc now carries the SDK's full context-source table with priorities, so a reader
can see where their file sits among `AGENTS.md`, `CLAUDE.md` and `.cursor/rules`.

Verified on a generated app: `typecheck`, `lint`, `format:check` and `test` all exit 0, and
`theokit build` completes with the hook attached.

## The root context file, and the option that never worked

`THEO.md` **cannot** live at the project root: the SDK registers it as `.theokit/THEO.md` with
`cwd-only` scope, so a copy at the root is read by nothing. The file that IS read from there is
`AGENTS.md` — `git-root-walk`, the same scope as `CLAUDE.md`, discovered from any subdirectory.

The scaffold now ships one, and the two files say what separates them:

| | `AGENTS.md` (root) | `.theokit/THEO.md` |
| --- | --- | --- |
| Audience | agents that **write** this code | the agent your **users** talk to |
| Content | commands, layout, conventions | product facts, domain vocabulary |
| Priority | 10 — anything overrides it | 60 — strongest file-layer source |

That ordering is why `THEO.md` warns against putting preferences in it: a tone instruction there
wins against every personality, which silently makes `usePersonality` do nothing.

**The `agentsMd` option was inert in three separate ways**, and shipping the file is what exposed
all three: `--agents-md` was documented in `--help` and never parsed; the prompt asked a question
whose answer changed nothing; and the code only ever *deleted* an `AGENTS.md` the template did not
have. The flag is now `--no-agents-md` (the direction that can change anything, since the default
is true), it is parsed, and it is applied after the prompts so a typed flag beats an earlier answer.
Verified through the real CLI: present by default, absent with the flag, `THEO.md` untouched either
way.
