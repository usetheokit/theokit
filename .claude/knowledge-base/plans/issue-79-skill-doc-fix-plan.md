---
slug: issue-79-skill-doc-fix
milestone_id:
created_at: 2026-07-06
goal: Fix the wrong defineAgentTool signature in the shipped theokit-agents SKILL.md so a user copying it gets code that compiles, and guard against regression.
---

# Plan — issue #79: SKILL.md defineAgentTool signature

## Goal

The default template's `dot-claude/skills/theokit-agents/SKILL.md` teaches
`defineAgentTool({ input, execute })` returning an object. The real API
(`DefineAgentToolSpec`) is `defineAgentTool({ inputSchema, handler })` where `handler` returns a
**string**. A user copying the doc gets code that fails `tsc`. Fix the example + guard it.

## Discover (verified against source)

- Real: `packages/theo/src/server/define/define-agent-tool.ts` —
  `DefineAgentToolSpec = { name, description, inputSchema: T, handler: (input: z.infer<T>) => string | Promise<string> }`.
- Wrong (SKILL.md lines 72-77): `input: z.object({})` + `execute: async () => ({ time: … })`.
- The `@Tool` decorator example in the SAME file uses `input:` — that is **correct** for `@Tool`
  (decorator ≠ `defineAgentTool`); do NOT touch it.
- Repo docs (`docs/migration/0.13-to-0.14`, `docs/guides/build-a-code-assistant`) are clean — their
  `input:` matches are `defineAgent({ input })` / `@Tool({ input })`, both correct.

## Coverage matrix

| Goal claim | Task |
|---|---|
| SKILL.md defineAgentTool example uses the real API | T1 |
| The corrected example compiles against the real `defineAgentTool` | T2 (evidence) |
| Regression guard so the SKILL can't drift again | T3 |

## Tasks

### T1 — Fix the SKILL.md `defineAgentTool` example
- `input:` → `inputSchema:`; `execute: async () => ({ time: … })` → `handler: async () => new Date().toISOString()`
  (return a **string**). Keep the surrounding `defineAgent({ tools: [currentTimeTool] })` wiring.

### T2 — Prove the corrected example compiles (evidence)
- Extract the corrected `defineAgentTool` snippet into a throwaway `.ts` in a scaffold with
  `theokit`/`@theokit/agents` installed; `tsc --noEmit` → 0 errors. This is the "100% functional" gate.

### T3 — Regression guard (repo test)
- Add an assertion to `tests/unit/create-theo-default-template.test.ts`: the SKILL.md
  `## Tools — defineAgentTool` block uses `inputSchema:` + `handler:` and does NOT use `execute:` or a
  bare `input:` field inside that block. Fail-closed on future drift.

## Acceptance criteria (evidence required)

- **AC-1** the SKILL.md `defineAgentTool` example uses `inputSchema` + `handler` (returns a string).
- **AC-2** the corrected snippet `tsc --noEmit` = 0 errors against the real `defineAgentTool`.
- **AC-3** the guard test fails on the OLD (input/execute) shape and passes on the corrected one.
- **AC-4** no other template/repo doc carries the wrong signature.

## Drawbacks & risks

1. Markdown snippets aren't compiled by the normal build — hence T2 extracts + compiles, and T3
   guards structurally so drift can't silently return.

## Unresolved questions

- (none) — the real API + the single drift site are confirmed from source.
